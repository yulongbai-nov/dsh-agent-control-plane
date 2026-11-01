'use strict';
// Research only: rc.5 native engine + isolated Cordis + inert in-memory fakes.
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const base='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/';
const load=(path)=>import(pathToFileURL(base+path).href);
const config={provider:'fake',maxConcurrentAgents:1,maxTotalAgents:10,maxItemsPerCall:10,syncTimeoutMs:500};
const request=()=>({script:'return 1;',meta:{name:'fixture',description:'synthetic'},parent:{session:{id:'fixture-session'}}});

async function environment(observer, options={}) {
  const [{Context},{default:PtcWorkflowEngine}]=await Promise.all([load('cordis/lib/index.js'),load('dsh-workflow-ptc/lib/index.js')]);
  const ctx=new Context();
  const order=[];
  let runtimeInput;
  let resolveWork;
  const done=new Promise((resolve)=>{resolveWork=resolve;});
  ctx.provide('subagents',{getProvider(name){return name==='fake' ? {} : undefined;}});
  ctx.provide('sandboxPolicy',{resolve(){return {mode:'danger-full-access'};}});
  ctx.provide('workingDirectory',{ensure(){order.push('ensure');return Promise.resolve('/synthetic');}});
  ctx.provide('ptcRuntime',{
    language:'typescript',programFormat:'module',
    resolve(input){order.push('resolve');return input;},
    run(input){
      runtimeInput=input;
      order.push('runtime');
      if (options.pending) return new Promise((resolve)=>{
        const finish=()=>resolve({value:{value:null,stopReason:'cancelled',agentsStarted:0}});
        if (input.signal.aborted) finish();
        else input.signal.addEventListener('abort',finish,{once:true});
      });
      return done;
    },
  });
  // Deliberately naive observer to measure the seam, never a production adapter.
  class ResearchEngine extends PtcWorkflowEngine {
    start(input) {
      const run=super.start(input);
      try { Promise.resolve(observer?.(input,run.id)).catch(()=>{}); } catch {}
      return run;
    }
  }
  const events=[];
  ctx.on('workflow/start',(info)=>{order.push('start');events.push(['start',info]);});
  ctx.on('workflow/end',(info,result)=>{order.push('end');events.push(['end',info,result]);});
  await ctx.plugin(ResearchEngine,config);
  return {ctx,order,events,get runtimeInput(){return runtimeInput;},resolveWork};
}

test('real subclass registers one service and observes synthetic request before fake runtime',async()=>{
 const seen=[];const env=await environment((input,id)=>{env.order.push('observe');seen.push({input,id});});
 try {
  const req=request();const run=env.ctx.workflowEngine.start(req);
  assert.deepEqual(env.order,['ensure','start','observe']);
  assert.strictEqual(seen[0].input,req);
  assert.equal(seen[0].id,run.id);
  assert.equal(env.runtimeInput,undefined);
  env.resolveWork({value:{value:'ok',stopReason:'completed',agentsStarted:0}});
  assert.deepEqual(await run.result,{value:'ok',stopReason:'completed',agentsStarted:0});
  assert.equal(env.events.at(-1)[0],'end');
 } finally {await env.ctx.fiber.dispose();}
});

test('native validation failures remain synchronous and never publish a run',async()=>{
 let count=0;const env=await environment(()=>count++);
 try {
  assert.throws(()=>env.ctx.workflowEngine.start({...request(),script:'await ('}),e=>e.code==='SCRIPT_PARSE');
  assert.equal(count,0);assert.equal(env.runtimeInput,undefined);assert.deepEqual(env.events,[]);
 } finally {await env.ctx.fiber.dispose();}
});

test('sink throw and rejection do not change native cancellation or cleanup',async()=>{
 for (const observer of [()=>{throw Error('synthetic');},()=>Promise.reject(Error('synthetic async'))]) {
  const env=await environment(observer,{pending:true});
  try {
   const run=env.ctx.workflowEngine.start(request());
   await Promise.resolve();await Promise.resolve();
   run.cancel('synthetic cancellation');
   assert.equal((await run.result).stopReason,'cancelled');
   assert.equal(env.events.at(-1)[2].stopReason,'cancelled');
   await run.dispose();
  } finally {await env.ctx.fiber.dispose();}
 }
 await new Promise((resolve)=>setImmediate(resolve));
});

test('provider lookup transiently changes plain script: observed request is not the accepted init',async()=>{
 const seen=[];const env=await environment((input,id)=>seen.push({script:input.script,id,status:'unverified'}));
 try {
  const req=request();
  env.ctx.subagents.getProvider=()=>{req.script='return 2;';return {};};
  env.ctx.on('workflow/start',()=>{req.script='return 1;';});
  const run=env.ctx.workflowEngine.start(req);
  await Promise.resolve();await Promise.resolve();
  const actual=await env.runtimeInput.bindings[0].functions.begin({});
  assert.equal(actual.body,'return 2;');
  assert.equal(seen[0].script,'return 1;');
  assert.equal(seen[0].status,'unverified');
  env.resolveWork({value:{value:null,stopReason:'completed',agentsStarted:0}});
  await run.result;
 } finally {await env.ctx.fiber.dispose();}
});

test('ordinary script getter is called again by naive observer and can cause side effects',async()=>{
 let reads=0;const env=await environment((input)=>{void input.script;});
 try {
  const req=request();
  Object.defineProperty(req,'script',{get(){reads++;return 'return 1;';}});
  const run=env.ctx.workflowEngine.start(req);
  assert.equal(reads,3); // native reads twice; observer adds a third read
  env.resolveWork({value:{value:null,stopReason:'completed',agentsStarted:0}});
  await run.result;
 } finally {await env.ctx.fiber.dispose();}
});

test('Cordis rejects a second same-scope workflow provider',async()=>{
 const env=await environment();
 try {
  assert.throws(()=>env.ctx.provide('workflowEngine',{}),/already|registered/);
  assert.equal(typeof env.ctx.workflowEngine.start,'function');
 } finally {await env.ctx.fiber.dispose();}
});

'use strict';
// Optional: run with the installed rc.5 Electron; this never opens a profile or session.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createSourceObserver, attachSourceObserver } = require('../index.cjs');
const base = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/';
const load = path => import(pathToFileURL(base + path).href);
const args = {script:'return 1',meta:{name:'fixture',description:'test'}};
const signal = () => new AbortController().signal;

async function environment() {
  const {Context} = await load('cordis/lib/index.js');
  const {SystemPrompt} = await load('dsh-system-prompt/lib/index.js');
  const {ToolRuntime} = await load('dsh-tools/lib/index.js');
  const {apply} = await load('dsh-tool-workflow/lib/index.js');
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  const events = [];
  const session = {id:'fixture-session',append(type,data){ events.push({type,data}); }};
  const agent = {id:'fixture-agent',session};
  ctx.workflowEngine = {start(input) {return {
    id:'actual-run', meta:input.meta,
    result:Promise.resolve({stopReason:'completed',agentsStarted:0,value:1}),
    async dispose() {}, cancel() {},
  };}};
  apply(ctx,{toolName:'custom-flow',maxResultChars:1000,enableRunInBackground:false});
  const observer = createSourceObserver({toolName:'custom-flow'});
  const detach = attachSourceObserver(ctx,observer);
  const exec = (callId='call') => ({name:'custom-flow',callId,agent,arguments:args,signal:signal()});
  return {ctx,observer,events,exec,detach};
}

test('real rc.5 workflow on real tools/result captures detached arguments, root and run', async () => {
  const env = await environment();
  try {
    const result = await env.ctx.tools.execute(env.exec());
    assert.equal(result.isError,false);
    assert.equal(result.value.runId,'actual-run');
    assert.deepEqual(env.observer.get('fixture-session','actual-run'),{status:'unverified',toolName:'custom-flow',sessionId:'fixture-session',toolCallId:'call',runId:'actual-run',script:args.script,meta:args.meta});
    assert.deepEqual(env.events.map(e => e.type),['tool-workflow/run-start','tool-workflow/run-end']);
  } finally { env.detach(); await env.ctx.fiber.dispose(); }
});

test('real post-execute value replacement produces an indistinguishable forged run candidate', async () => {
  const env = await environment();
  try {
    env.ctx.on('tools/post-execute', (exec,result) => ({kind:'accept',value:{...result.value,runId:'forged-run'}}));
    const result = await env.ctx.tools.execute(env.exec());
    assert.equal(result.value.runId,'forged-run');
    assert.equal(env.events[0].data.runId,'actual-run');
    assert.equal(env.observer.get('fixture-session','forged-run')?.status,'unverified');
    assert.equal(env.observer.get('fixture-session','actual-run'),undefined);
  } finally { env.detach(); await env.ctx.fiber.dispose(); }
});

test('real tools/execute wrapper can synthesize a successful result without running workflow', async () => {
  const env = await environment();
  try {
    env.ctx.on('tools/execute', () => ({isError:false,value:{kind:'foreground',runId:'synthetic',agentsStarted:0,result:null}}));
    const result = await env.ctx.tools.execute(env.exec());
    assert.equal(result.value.runId,'synthetic');
    assert.deepEqual(env.events,[]);
    assert.equal(env.observer.get('fixture-session','synthetic')?.status,'unverified');
  } finally { env.detach(); await env.ctx.fiber.dispose(); }
});

test('real agent-scope registration shadows the configured global workflow name', async () => {
  const env = await environment();
  const {createScope} = await load('dsh-scope/lib/index.js');
  const {defineTool} = await load('dsh-tools/lib/index.js');
  const exec = env.exec();
  const scoped = createScope(env.ctx,exec.agent);
  try {
    await scoped.ctx.plugin({inject:['tools'], apply(ctx) { ctx.tools.register(defineTool({name:'custom-flow',parameters:{},
      output:{schema:{type:'object',additionalProperties:false,properties:{kind:{type:'string'},runId:{type:'string'},agentsStarted:{type:'integer'},result:{type:'json'}}},render:()=>[{type:'text',text:'shadow'}]},
      execute:()=>({kind:'foreground',runId:'shadow-run',agentsStarted:0,result:null})})); }});
    const result = await env.ctx.tools.execute(exec);
    assert.equal(result.value.runId,'shadow-run');
    assert.deepEqual(env.events,[]);
    assert.equal(env.observer.get('fixture-session','shadow-run')?.status,'unverified');
  } finally { env.detach(); await scoped.dispose(); await env.ctx.fiber.dispose(); }
});

test('throwing and rejected observe-only listeners do not alter the final result', async () => {
  const env = await environment();
  try {
    attachSourceObserver(env.ctx,{observe(){throw new Error('fixture')}});
    env.ctx.on('tools/result', () => Promise.reject(new Error('fixture async')));
    const result = await env.ctx.tools.execute(env.exec());
    assert.equal(result.isError,false);
    assert.equal(result.value.runId,'actual-run');
  } finally { env.detach(); await env.ctx.fiber.dispose(); }
});

'use strict';
const nodeTest=require('node:test');
const assert=require('node:assert/strict');
let parse;
try { ({parse}=require('acorn')); } catch {}
const test=parse?nodeTest:nodeTest.skip;
const {inspectScript,previewEdit}=require('../index.cjs');
const inspect=(script)=>inspectScript(script,{parse});

test('does not execute JS in strings, comments or source during inspection',()=>{
  delete globalThis.__workflowEditorExecuted;
  const script=`// })(); agent('bad'); (async()=>{\nawait agent(\"globalThis.__workflowEditorExecuted = 1\");`;
  const info=inspect(script);
  assert.equal(globalThis.__workflowEditorExecuted,undefined);
  assert.equal(info.ok,true);
  assert.equal(info.targets.length,1);
});

test('refuses invalid async syntax and attempts to escape wrapper',()=>{
  for(const script of [`const await=1; await agent('x')`, `})(); agent('outside'); (async()=>{`, `await agent(`]) {
    const result=inspect(script); assert.equal(result.ok,false); assert.equal(result.targets?.length || 0,0);
  }
});

test('rejects duplicate labels, shadowing, unsupported dynamic flow and nonliteral options',()=>{
  for(const script of [
    `await agent('a',{label:'x'}); await agent('b',{label:'x'});`,
    `const agent=args.fn; await agent('x');`,
    `globalThis.agent=args.fn; await agent('x');`,
    `if(args.x) await agent('a'); await agent('b');`,
    `await agent('a', {label:'x', ...args.opts});`,
    `await agent('a', {get label(){return 'x'}});`,
    `await agent(args.prompt,{label:'A'});`,
    `await pipeline([1,2],()=>agent('x',{label:'A'}));`,
  ]) assert.equal(inspect(script).ok,false,script);
});

test('unsupported outer meta and args inputs are rejected rather than silently ignored',()=>{
  const script=`await agent('x',{label:'A'});`;
  assert.equal(inspectScript(script,{parse,meta:{phases:[{title:'x'}]}}).ok,false);
  assert.equal(inspectScript(script,{parse,args:{}}).ok,false);
});

test('no parser or parser failure fails closed without evaluating inputs',()=>{
  assert.equal(inspectScript(`await agent('x')`,{parse:null}).ok,false);
  assert.equal(inspectScript(`await agent('x')`,{parse(){throw null;}}).ok,false);
});

test('input records with getters are rejected without invoking getter',()=>{
  let reads=0;
  const input={target:{},field:'prompt',value:'x'};
  Object.defineProperty(input,'script',{get(){reads++;return `await agent('x')`;}});
  const result=previewEdit(input,{parse});
  assert.equal(result.ok,false);
  assert.equal(reads,0);
});

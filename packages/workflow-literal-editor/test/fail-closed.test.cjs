'use strict';
const nodeTest=require('node:test');
const assert=require('node:assert/strict');
let parse;
try { ({parse}=require('acorn')); } catch {}
const test=parse?nodeTest:nodeTest.skip;
const {inspectScript,previewEdit}=require('../index.cjs');

test('host parse failure or malformed output always returns a refusal',()=>{
 for(const parser of [()=>{throw null;},()=>null,()=>({type:'Program',body:[]})]){
  assert.doesNotThrow(()=>assert.equal(inspectScript(`await agent('x')`,{parse:parser}).ok,false));
 }
});

test('proxied input, target and options are rejected without trap execution',()=>{
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('proxy');},getPrototypeOf(){traps++;throw Error('proxy');},ownKeys(){traps++;throw Error('proxy');}});
 assert.equal(previewEdit(proxy,{parse}).ok,false);
 const script=`await agent('x');`;
 const target=inspectScript(script,{parse}).targets[0];
 assert.equal(previewEdit({script,target:proxy,field:'prompt',value:'y'},{parse}).ok,false);
 assert.equal(previewEdit({script,target,field:'prompt',value:'y'},proxy).ok,false);
 assert.equal(traps,0);
});

test('single line comments and escape payloads remain syntax-only data',()=>{
 for(const payload of ["a'\\\n};throw 1;//",'\\u2028\u2029\ud800',`})(); globalThis.x=1; (async()=>{`]){
  const script=`await agent('x',{label:'unique'});`;
  const info=inspectScript(script,{parse});
  const result=previewEdit({script,target:info.targets[0],field:'prompt',value:payload},{parse});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.topology.nodes.length,1);
 }
});

test('edited phase order and coordinates stay stable under real declared phases',()=>{
 const {extractTopology,layoutTopology}=require('../../workflow-topology/index.cjs');
 const script=`phase('Build');await agent('x',{label:'A'});phase('Review');await agent('y',{label:'B'});`;
 const meta={phases:[{title:'Review'},{title:'Build'}]};
 const info=inspectScript(script,{parse});
 const result=previewEdit({script,target:info.targets[0],field:'prompt',value:'longer prompt'},{parse});
 assert.equal(result.ok,true);
 const positions=(s)=>layoutTopology(extractTopology(s,meta,{parse})).nodes.map(({column,row,x,y,width,height})=>({column,row,x,y,width,height}));
 assert.deepEqual(positions(result.script),positions(script));
});

test('value parameters are limited to primitive strings even with coercion hooks',()=>{
 const script=`await agent('x',{label:'A'});`;
 const info=inspectScript(script,{parse});
 let invoked=0;
 const payload={toString(){invoked++;throw Error('must not coerce');}};
 assert.equal(previewEdit({script,target:info.targets[0],field:'prompt',value:payload},{parse}).ok,false);
 assert.equal(invoked,0);
});

test('caller-provided meta or args outside the supported API are not silently ignored',()=>{
 const script=`await agent('x',{label:'A'});`;
 const info=inspectScript(script,{parse});
 const result=previewEdit({script,target:info.targets[0],field:'prompt',value:'p',meta:{phases:[]},args:{}},{parse});
 assert.equal(result.ok,false);
});

test('edits that collide label with another site fail atomically',()=>{
 const script=`await agent('x',{label:'first'});await agent('y',{label:'second'});`;
 const info=inspectScript(script,{parse});
 const result=previewEdit({script,target:info.targets[0],field:'label',value:'second'},{parse});
 assert.equal(result.ok,false);
 assert.ok(!Object.hasOwn(result,'script'));
});

test('preview does not accidentally run source hidden in comments',()=>{
 const script=`/* globalThis.__executed=true */ await agent('x',{label:'A'});`;
 delete globalThis.__executed;
 const info=inspectScript(script,{parse});
 const result=previewEdit({script,target:info.targets[0],field:'prompt',value:'p'},{parse});
 assert.equal(result.ok,true);
 assert.equal(globalThis.__executed,undefined);
});

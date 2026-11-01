'use strict';
const nodeTest=require('node:test');
const assert=require('node:assert/strict');
let parse;
try { ({parse}=require('acorn')); } catch {}
const test=parse?nodeTest:nodeTest.skip;
const {inspectScript,previewEdit}=require('../index.cjs');
const inspect=(s)=>inspectScript(s,{parse});
const preview=(s,target,field,value)=>previewEdit({script:s,target,field,value},{parse});

test('empty agent prompt would break real workflow runtime contract and must be refused',()=>{
 const script=`await agent('p',{label:'x'});`;
 assert.equal(preview(script,inspect(script).targets[0],'prompt','').ok,false);
});

test('source fingerprints distinguish different lone surrogate code units',()=>{
 const a=`await agent('\ud800',{label:'x'});`;
 const b=`await agent('\ud801',{label:'x'});`;
 assert.notEqual(inspect(a).sourceHash,inspect(b).sourceHash);
});

test('empty source or phase-only workflow offers no editable target',()=>{
 for(const s of ['',`phase('one');`]) {
  const info=inspect(s);
  assert.equal(info.ok,true);
  assert.deepEqual(info.targets,[]);
 }
});

test('dangerous object getters on target and parser options do not execute',()=>{
 let calls=0; const script=`await agent('p');`;
 const target=inspect(script).targets[0];
 const badTarget={...target};Object.defineProperty(badTarget,'nodeId',{get(){calls++;return target.nodeId;}});
 assert.equal(preview(script,badTarget,'prompt','x').ok,false);
 const options={};Object.defineProperty(options,'parse',{get(){calls++;return parse;}});
 assert.equal(inspectScript(script,options).ok,false);
 assert.equal(calls,0);
});

test('reject direct hook expressions with spread or getter options, numeric and interpolation values',()=>{
 for(const script of [`await agent(...['a']);`,`await agent('a',{get label(){return 'x'}});`,`await agent('a',{label:5});`,`await agent('a',{label:\`x\${args.x}\`});`]) assert.equal(inspect(script).ok,false,script);
});

test('unchanged original agent fields must already meet the pinned runtime contract',()=>{
 for(const script of [`phase('');await agent('x');`,`await agent('x',{provider:''});`,`await agent('x',{provider:' spaced '});`,`await agent('x',{model:''});`])
  assert.equal(inspect(script).ok,false,script);
});

test('editing prompt that sets the implicit default label requires an explicit label',()=>{
 const script=`await agent('short prompt');`;
 const info=inspect(script);
 const result=preview(script,info.targets[0],'prompt','changed prompt');
 assert.equal(result.ok,false);
 assert.deepEqual(info.targets[0].fields,[]);
});

test('explicit empty label is retained when prompt changes',()=>{
 const script=`await agent('p',{label:''});`;
 const info=inspect(script);
 const result=preview(script,info.targets[0],'prompt','different');
 assert.equal(result.ok,true);
 assert.equal(info.topology.nodes[0].label,'');
 assert.equal(result.topology.nodes[0].label,'');
 assert.equal(inspect(result.script).topology.nodes[0].label,'');
});

test('unpaired UTF-16 values survive literal encoding without changing data',()=>{
 const script=`await agent('p',{label:'x'});`;
 const value='\ud800';
 const result=preview(script,inspect(script).targets[0],'prompt',value);
 assert.equal(result.ok,true);
 assert.equal(result.diff.after,'"\\ud800"');
});

test('oversized source or replacement is rejected before expensive processing',()=>{
 const script=`await agent('p',{label:'x'});`;
 assert.equal(inspect(' '.repeat(100001)).ok,false);
 assert.equal(preview(script,inspect(script).targets[0],'prompt','x'.repeat(100001)).ok,false);
});

test('target shadow data properties are never coerced into executable objects',()=>{
 let coercions=0;
 const script=`await agent('a');`;
 const target=inspect(script).targets[0];
 const field={toString(){coercions++;throw Error('unsafe');}};
 assert.doesNotThrow(()=>assert.equal(preview(script,target,field,'x').ok,false));
 assert.equal(coercions,0);
});

test('length-changing edit maps all later node ids, preserving layout',()=>{
 const script=`await agent('a',{label:'first'}); await agent('b',{label:'second'});`;
 const before=inspect(script);
 const result=preview(script,before.targets[0],'prompt','longer string');
 assert.equal(result.ok,true);
 assert.notEqual(result.nodeMapping[1].before,result.nodeMapping[1].after);
 assert.deepEqual(result.layout.nodes.map(({x,y})=>[x,y]),before.layout.nodes.map(({x,y})=>[x,y]));
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMemoryRecords}=require('../index.cjs');
const store=()=>createMemoryRecords();
const key={sessionId:'s1',runId:'r1'};
const start=(seq=1)=>({type:'run-start',eventSeq:seq});
const end=(seq=2,outcome='completed')=>({type:'run-end',eventSeq:seq,outcome});

test('unknown read, run lifecycle, idempotency and immutable copies',()=>{
 const records=store();
 assert.deepEqual(records.read(key),{state:'unknown'});
 const a=records.observe(key,start());
 assert.equal(a.state,'observed');assert.equal(a.revision,1);
 assert.equal(a.sourceStatus,'unverified');assert.equal(a.lifecycle,'unknown');
 assert.equal(a.hasStart,true);assert.equal(a.lastEventSeq,1);
 const b=records.observe(key,end());
 assert.equal(b.revision,2);assert.equal(b.lifecycle,'completed');
 assert.equal(b.startEventSeq,1);assert.equal(b.lastEventSeq,2);
 assert.deepEqual(records.observe(key,end()),b);
 assert.deepEqual(records.read(key),b);
 try {b.revision=99;} catch {}
 assert.equal(records.read(key).revision,2);
 assert.ok(Object.isFrozen(records.read(key)));
});

test('an orphan end never establishes a durable or completed lifecycle',()=>{
 const records=store();
 const snapshot=records.observe(key,end());
 assert.equal(snapshot.state,'incomplete');
 assert.equal(snapshot.hasStart,false);
 assert.equal(snapshot.lifecycle,'unknown');
 assert.equal(snapshot.sourceStatus,'unverified');
 assert.equal(Object.hasOwn(snapshot,'durable'),false);
});

test('replay of original start is idempotent after end while old conflicting facts are rejected',()=>{
 const records=store();records.observe(key,start());const terminal=records.observe(key,end());
 assert.deepEqual(records.observe(key,start()),terminal);
 assert.throws(()=>records.observe(key,end(1)),{code:'CONFLICT'});
 assert.deepEqual(records.read(key),terminal);
});

test('same sequence conflict or reversed ordering fail without mutation',()=>{
 const records=store();const before=records.observe(key,start(3));
 assert.throws(()=>records.observe(key,end(3)),{code:'CONFLICT'});
 assert.throws(()=>records.observe(key,end(2)),{code:'OUT_OF_ORDER'});
 assert.deepEqual(records.read(key),before);
});

test('snapshot preserves start and end sequences required for adapter replay and comparison',()=>{
 const records=store();records.observe(key,start(10));
 const snapshot=records.observe(key,end(12,'error'));
 assert.deepEqual({start:snapshot.startEventSeq,end:snapshot.lastEventSeq,lifecycle:snapshot.lifecycle}, {start:10,end:12,lifecycle:'failed'});
});

test('runs are independently scoped by both session and run id',()=>{
 const records=store();records.observe(key,start());
 assert.deepEqual(records.read({sessionId:'s2',runId:'r1'}),{state:'unknown'});
 assert.deepEqual(records.read({sessionId:'s1',runId:'r2'}),{state:'unknown'});
});

test('end after start is only an observed lifecycle, never a durable or complete source assertion',()=>{
 const records=store();records.observe(key,start());
 for(const outcome of ['completed','error','cancelled']) {
  const r=store();r.observe(key,start());const snapshot=r.observe(key,end(2,outcome));
  assert.equal(snapshot.state,'observed');
  assert.equal(snapshot.lifecycle,({completed:'completed',error:'failed',cancelled:'cancelled'})[outcome]);
  assert.equal(snapshot.sourceStatus,'unverified');
  for(const forbidden of ['durable','complete','verified','sourceBinding','source']) assert.equal(Object.hasOwn(snapshot,forbidden),false);
 }
});

test('future storage adaptors receive persistable orphan end evidence without claiming lifecycle',()=>{
 const records=store();
 const snapshot=records.observe(key,end(7,'error'));
 assert.equal(snapshot.state,'incomplete');
 assert.equal(snapshot.lifecycle,'unknown');
 assert.equal(snapshot.startEventSeq,null);
 assert.equal(snapshot.lastEventSeq,7);
 assert.equal(snapshot.observedOutcome,'error');
 assert.equal(snapshot.sourceStatus,'unverified');
});

test('only safe enumerated lifecycle fields are accepted, no content or verified input',()=>{
 const records=store();
 for(const value of [
  {...start(),script:'secret'}, {...start(),name:'secret'}, {...start(),label:'secret'}, {...start(),args:{}},
  {...start(),sourceStatus:'verified'}, {...start(),sourceBinding:{status:'verified'}},
  {...end(),outcome:'fake'}, {type:'agent-start',eventSeq:1},
 ]) assert.throws(()=>records.observe(key,value),{code:'INVALID_INPUT'});
 assert.deepEqual(records.read(key),{state:'unknown'});
});

test('native workflow stop reasons are retained, mapped only in lifecycle, and unknowns fail closed',()=>{
 const native=['completed','error','cancelled'];
 for (const [i,outcome] of native.entries()) {
  const records=store();records.observe(key,start());
  const snapshot=records.observe(key,end(2,outcome));
  assert.equal(snapshot.observedOutcome,outcome);
  assert.equal(snapshot.lifecycle,['completed','failed','cancelled'][i]);
 }
 for (const unknown of ['failed','timeout','interrupted','',null,undefined]) {
  const records=store();records.observe(key,start());
  assert.throws(()=>records.observe(key,{type:'run-end',eventSeq:2,outcome:unknown}),{code:'INVALID_INPUT'});
  assert.equal(records.read(key).revision,1);
 }
 const records=store();records.observe(key,start());
 assert.throws(()=>records.observe(key,{type:'run-end',eventSeq:2,stopReason:'completed'}),{code:'INVALID_INPUT'});
});

test('invalid native event sequence and malformed keys are rejected',()=>{
 const records=store();
 for(const n of [undefined,null,-1,-0,1.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>records.observe(key,{type:'run-start',eventSeq:n}),{code:'INVALID_INPUT'});
 for(const bad of [{sessionId:'',runId:'r'},{sessionId:'s',runId:''},{sessionId:'s',runId:'r',extra:1},{}]) assert.throws(()=>records.read(bad),{code:'INVALID_INPUT'});
});

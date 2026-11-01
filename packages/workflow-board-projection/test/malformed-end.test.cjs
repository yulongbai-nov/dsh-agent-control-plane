'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {projectWorkflow} = require('../index.cjs');
const event = (type, seq, data, runId='r') => ({type:`tool-workflow/${type}`,seq,time:100+seq,data:{runId,...data}});
const agent = (id,label) => ({id,label,kind:'agent',phase:null,occurrence:'single'});
const project = (events) => projectWorkflow({
  runId:'r',events,sourceBinding:{status:'verified',runId:'r',toolCallId:'call'},
  topology:{version:1,complete:true,nodes:[agent('a','A'),agent('b','B')]},
  layout:{version:1,nodes:[],groups:[]},
});
const start = (seq) => event('run-start',seq,{name:'workflow'});
const as = (seq,n,label) => event('agent-start',seq,{seq:n,label,childId:`child-${n}`});
const ae = (seq,n,outcome,runId='r') => event('agent-end',seq,{seq:n,outcome},runId);
const end = (seq) => event('run-end',seq,{stopReason:'completed'});

test('invalid agent-end outcome invalidates entire run and all invocation outcomes', () => {
  for (const outcome of ['not-real',undefined,null,42]) {
    const graph = project([start(0),as(1,1,'A'),ae(2,1,'completed'),as(3,2,'B'),ae(4,2,outcome),end(5)]);
    assert.equal(graph.run.status,'unknown');
    assert.deepEqual(graph.statusByNode,{});
    assert.equal(graph.unmatched.length,2);
    assert.ok(graph.unmatched.every(({status}) => status==='unknown'));
    assert.ok(graph.diagnostics.some(({code}) => code==='INVALID_AGENT_END'));
  }
});

test('absent outcome property fails closed without inventing completion', () => {
  const missing = event('agent-end',4,{seq:2});
  assert.equal(Object.hasOwn(missing.data,'outcome'),false);
  const graph = project([start(0),as(1,1,'A'),ae(2,1,'completed'),as(3,2,'B'),missing,end(5)]);
  assert.equal(graph.run.status,'unknown');
  assert.deepEqual(graph.statusByNode,{});
  assert.ok(graph.unmatched.every(({status}) => status==='unknown'));
  assert.ok(graph.diagnostics.some(({code}) => code==='INVALID_AGENT_END'));
});

test('duplicate agent-end invalidates entire run and all invocation outcomes', () => {
  for (const outcome of ['completed','failed']) {
    const graph = project([start(0),as(1,1,'A'),ae(2,1,'completed'),as(3,2,'B'),ae(4,2,'completed'),ae(5,2,outcome),end(6)]);
    assert.equal(graph.run.status,'unknown');
    assert.deepEqual(graph.statusByNode,{});
    assert.ok(graph.unmatched.every(({status}) => status==='unknown'));
    assert.ok(graph.unmatched.some(({reason}) => reason==='conflicting-seq'));
  }
});

test('invalid or duplicate end from another run does not taint a valid run', () => {
  const graph = project([start(0),as(1,1,'A'),ae(2,1,'completed'),ae(3,7,'invalid','foreign'),ae(4,7,'completed','foreign'),ae(5,7,'failed','foreign'),end(6)]);
  assert.equal(graph.run.status,'completed');
  assert.equal(graph.statusByNode.a.status,'completed');
  assert.ok(!graph.diagnostics.some(({code}) => code==='INVALID_AGENT_END'));
});

test('normal two-agent lifecycle continues to bind completed results', () => {
  const graph = project([start(0),as(1,1,'A'),ae(2,1,'completed'),as(3,2,'B'),ae(4,2,'completed'),end(5)]);
  assert.equal(graph.run.status,'completed');
  assert.equal(graph.statusByNode.a.status,'completed');
  assert.equal(graph.statusByNode.b.status,'completed');
});

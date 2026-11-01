'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectWorkflow } = require('../index.cjs');
const node = (id,label) => ({id,label,phase:null,kind:'agent',occurrence:'single'});
const evt = (type,seq,data) => ({type:`tool-workflow/${type}`,seq,time:100+seq,data:{runId:'r',...data}});
const start = (eventSeq,seq,label) => evt('agent-start',eventSeq,{seq,label,childId:`c${seq}`});
const end = (eventSeq,seq,outcome='completed') => evt('agent-end',eventSeq,{seq,outcome});
const project = (events) => projectWorkflow({runId:'r',topology:{version:1,complete:true,nodes:[node('a','A')]},layout:{version:1,nodes:[],groups:[]},events,sourceBinding:{runId:'r',status:'verified',toolCallId:'call'}});

test('a run end recorded before an agent start or agent end is inconsistent, not completed', () => {
  const graph = project([evt('run-end',1,{stopReason:'completed'}),start(2,1,'A'),end(3,1)]);
  assert.equal(graph.run.status,'unknown');
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.ok(graph.diagnostics.some((x) => x.code === 'INVALID_RUN_ORDER'));
});

test('out of order or duplicated session event sequence cannot invent causal order', () => {
  for (const events of [[start(2,1,'A'),end(1,1)], [start(1,1,'A'),end(1,1)]]) {
    const graph = project(events);
    assert.deepEqual(Object.keys(graph.statusByNode),[]);
    assert.ok(graph.diagnostics.some((x) => x.code === 'INVALID_EVENT_ORDER'));
  }
});

test('duplicate starts or ends invalidate all matches that could be the conflicting invocation', () => {
  const graph = project([start(1,1,'A'),start(2,1,'B'),start(3,2,'A')]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
});

test('a later same-label start revokes an earlier seemingly unique projection', () => {
  const first = start(1,1,'A');
  const early = project([first]);
  assert.equal(early.statusByNode.a.seq,1);
  const later = project([first,start(2,2,'A')]);
  assert.deepEqual(Object.keys(later.statusByNode),[]);
  assert.deepEqual(later.unmatched.map((entry) => entry.reason),['ambiguous-runtime','ambiguous-runtime']);
});

test('redelivery of an identical native session sequence is not a second invocation', () => {
  const first = start(1,1,'A');
  const graph = project([first,structuredClone(first),end(2,1)]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.ok(graph.diagnostics.some((x) => x.code === 'INVALID_EVENT_ORDER'));
});

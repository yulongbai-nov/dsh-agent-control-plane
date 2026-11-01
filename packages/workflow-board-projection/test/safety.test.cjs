'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectWorkflow } = require('../index.cjs');
const node = (id,label,phase=null) => ({id,label,phase,kind:'agent',occurrence:'single'});
const evt = (type,data) => ({type:`tool-workflow/${type}`,data:{runId:'r',...data}});
const start = (seq,label,phase) => evt('agent-start',{seq,label,childId:`c${seq}`,...(phase === undefined ? {} : {phase})});
const project = (nodes,events) => projectWorkflow({runId:'r',topology:{version:1,nodes,complete:true},layout:{version:1,nodes:[],groups:[]},events:events.map((event, seq) => ({...event,seq,time:100+seq})),sourceBinding:{status:'verified',runId:'r',toolCallId:'call-1'}});

test('dynamic label is never itself used as a certain match', () => {
  const graph = project([node('a',null)],[start(1,'dynamic')]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.equal(graph.unmatched[0].reason,'ambiguous-static');
});

test('unphased nodes cannot be distinguished by a runtime phase the parser did not establish', () => {
  const graph = project([node('a','A',null)],[start(1,'A','anything')]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.equal(graph.unmatched[0].reason,'ambiguous-static');
});

test('an isolated end may belong to a repeat invocation and invalidates other candidate mappings', () => {
  const graph = project([node('a','A')],[start(1,'A'),evt('agent-end',{seq:2,outcome:'completed'})]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.ok(graph.unmatched.some((item)=>item.reason === 'missing-start'));
});

test('start and end with the same id but reversed in the log are not accepted', () => {
  const graph = project([node('a','A')],[evt('agent-end',{seq:1,outcome:'completed'}),start(1,'A')]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.equal(graph.unmatched[0].reason,'conflicting-seq');
});

test('a rejected start preserves a warning and cannot make other bindings look unique', () => {
  const graph = project([node('a','A')],[start(1,'A'),evt('agent-start',{seq:2,label:'A'})]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.ok(graph.diagnostics.some(({code}) => code === 'INVALID_AGENT_START'));
});

test('identical label and phase from two nodes remain ambiguous even when only one runtime invocation observed', () => {
  const graph = project([node('a','A','x'),node('b','A','x')],[start(1,'A','x')]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.equal(graph.unmatched[0].reason,'ambiguous-static');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectWorkflow } = require('../index.cjs');
const event = (type, seq, data = {}, runId = 'r') => ({ type: `tool-workflow/${type}`, seq, data: {runId, ...data} });
const start = (seq, runId) => event('run-start', seq, {name:'workflow'}, runId);
const end = (seq, reason='completed', runId) => event('run-end', seq, {stopReason:reason}, runId);
const agentStart = (seq, runId) => event('agent-start', seq, {seq:1,label:'A',childId:'child'}, runId);
const agentEnd = (seq, runId) => event('agent-end', seq, {seq:1,outcome:'completed'}, runId);
const project = events => projectWorkflow({
  runId:'r', events, sourceBinding:{status:'verified',runId:'r',toolCallId:'c'},
  topology:{version:1,complete:true,nodes:[{id:'a',kind:'agent',label:'A',phase:null,occurrence:'single'}]},
  layout:{version:1,nodes:[],groups:[]},
});
function invalid(events, expectedCode='INVALID_RUN_ORDER') {
  const graph=project(events);
  assert.equal(graph.run.status,'unknown');
  assert.deepEqual(graph.statusByNode,{});
  assert.ok(graph.unmatched.every(member=>member.status==='unknown'));
  assert.ok(graph.diagnostics.some(item=>item.code===expectedCode));
}

test('an orphan run end never establishes a terminal run', () => {
  for (const reason of ['completed','error','cancelled']) invalid([end(2,reason)]);
});

test('agent starts or ends before the run start cannot bind or report outcomes', () => {
  invalid([agentStart(0), agentEnd(1)]);
  invalid([agentStart(0), agentEnd(1), end(2)]);
  invalid([agentEnd(0)]);
  invalid([agentStart(0), start(1), agentEnd(2), end(3)]);
  invalid([agentEnd(0), start(1), end(2)]);
});

test('a terminal run cannot be inferred while an observed invocation lacks an end', () => {
  for (const reason of ['completed','error','cancelled']) invalid([start(0), agentStart(1), end(2,reason)]);
  invalid([start(0), agentEnd(1), end(2)]);
});

test('duplicate invocation start and unmatched invocation end make terminal unknown', () => {
  invalid([start(0),agentStart(1),agentStart(2),agentEnd(3),end(4)]);
  invalid([start(0),agentStart(1),agentEnd(2),agentEnd(3),end(4)]);
  invalid([start(0),agentEnd(1),agentStart(2),end(3)]);
});

test('event order, repeated lifecycle, and activity following run-end remain invalid', () => {
  invalid([start(0),start(1),end(2)],'CONFLICTING_RUN_START');
  invalid([start(0),end(1),end(2)]);
  invalid([start(0),end(1),agentStart(2)]);
  invalid([start(2),agentStart(1),agentEnd(3),end(4)],'INVALID_EVENT_ORDER');
});

test('complete observed lifecycle retains each terminal reason without claiming durability', () => {
  for (const [reason,status] of [['completed','completed'],['error','failed'],['cancelled','cancelled']]) {
    const graph=project([start(0),agentStart(1),agentEnd(2),end(3,reason)]);
    assert.equal(graph.run.status,status);
    assert.equal(graph.statusByNode.a.status,'completed');
    assert.ok(!graph.diagnostics.some(({code})=>code==='INVALID_RUN_ORDER'));
    assert.equal(Object.hasOwn(graph.run,'durable'),false);
  }
  assert.equal(project([start(0),end(1)]).run.status,'completed');
});

test('legitimate run prefix stays unknown while retaining already observed invocation outcome', () => {
  const graph=project([start(0),agentStart(1),agentEnd(2)]);
  assert.equal(graph.run.status,'unknown');
  assert.equal(graph.statusByNode.a.status,'completed');
  assert.ok(!graph.diagnostics.some(({code})=>code==='INVALID_RUN_ORDER'));
});

test('malformed run-start cannot be cured by a later valid start', () => {
  invalid([event('run-start',0,{name:42}),start(1),agentStart(2),agentEnd(3),end(4)],'CONFLICTING_RUN_START');
  invalid([event('run-start',0,{name:'first'}),start(1),agentStart(2),agentEnd(3),end(4)],'CONFLICTING_RUN_START');
  invalid([event('run-start','bad',{name:'first'}),start(1),agentStart(2),agentEnd(3),end(4)],'INVALID_EVENT_SEQ');
});

test('foreign-run orphan events do not contaminate the target lifecycle', () => {
  const graph=project([end(0,'completed','other'),start(1),agentStart(2),agentEnd(3),end(4)]);
  assert.equal(graph.run.status,'completed');
  assert.equal(graph.statusByNode.a.status,'completed');
  assert.ok(!graph.diagnostics.some(({code})=>code==='INVALID_RUN_ORDER'));
});

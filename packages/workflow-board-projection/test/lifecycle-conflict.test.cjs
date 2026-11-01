'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {projectWorkflow} = require('../index.cjs');
const ev = (type,seq,data,runId='r') => ({type:`tool-workflow/${type}`,seq,time:100+seq,data:{runId,...data}});
const runStart = (seq,name='workflow') => ev('run-start',seq,{name});
const agentStart = (seq) => ev('agent-start',seq,{seq:1,label:'A',childId:'child'});
const agentEnd = (seq) => ev('agent-end',seq,{seq:1,outcome:'completed'});
const runEnd = (seq) => ev('run-end',seq,{stopReason:'completed'});
const project = (events) => projectWorkflow({
  runId:'r',events,sourceBinding:{status:'verified',runId:'r',toolCallId:'call'},
  topology:{version:1,complete:true,nodes:[{id:'a',kind:'agent',label:'A',phase:null,occurrence:'single'}]},
  layout:{version:1,nodes:[],groups:[]},
});

test('contradictory run lifecycle blocks binding and outcome certainty', () => {
  const cases = [
    [runStart(0),runStart(1),agentStart(2),agentEnd(3),runEnd(4)],
    [runStart(0,123),agentStart(1),agentEnd(2),runEnd(3)],
    [runStart(0),agentStart(1),agentEnd(2),ev('run-end',3,{stopReason:'invalid'})],
    [runStart(0),agentStart(1),agentEnd(2),runEnd(3),runEnd(4)],
  ];
  for (const events of cases) {
    const graph=project(events);
    assert.equal(graph.run.status,'unknown');
    assert.deepEqual(graph.statusByNode,{});
    assert.equal(graph.unmatched[0].status,'unknown');
  }
});

test('malformed agent invocation sequence invalidates completed run', () => {
  const graph=project([runStart(0),ev('agent-start',1,{seq:'1',label:'A',childId:'child'}),runEnd(2)]);
  assert.equal(graph.run.status,'unknown');
  assert.ok(graph.diagnostics.some(({code})=>code==='INVALID_AGENT_SEQ'));
});

test('ordinary run retains completed status and binding', () => {
  const graph=project([runStart(0),agentStart(1),agentEnd(2),runEnd(3)]);
  assert.equal(graph.run.status,'completed');
  assert.equal(graph.statusByNode.a.status,'completed');
});

test('a contradictory foreign lifecycle does not taint this run', () => {
  const foreign = ev('run-start',1,{name:123},'other');
  const graph=project([runStart(0),foreign,agentStart(2),agentEnd(3),runEnd(4)]);
  assert.equal(graph.run.status,'completed');
  assert.equal(graph.statusByNode.a.status,'completed');
});

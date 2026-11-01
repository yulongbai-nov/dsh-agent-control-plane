'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {projectWorkflow} = require('../index.cjs');
const event = (type,seq,data) => ({type:`tool-workflow/${type}`,seq,time:100,data:{runId:'r',...data}});
const project = (events) => projectWorkflow({
  runId:'r',events,sourceBinding:{status:'verified',runId:'r',toolCallId:'call'},
  topology:{version:1,complete:true,nodes:[{id:'a',kind:'agent',label:'A',phase:null,occurrence:'single'}]},
  layout:{version:1,nodes:[],groups:[]},
});
const start = () => event('agent-start',0,{seq:1,label:'A',childId:'child'});
const end = (seq) => event('agent-end',seq,{seq:1,outcome:'completed'});
const runEnd = () => event('run-end',20,{stopReason:'completed'});

test('missing or malformed native event sequence cannot produce a trusted result', () => {
  for (const bad of [undefined, null, -5, -0, '2', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const graph = project([start(),end(bad),runEnd()]);
    assert.ok(graph.diagnostics.some(({code}) => code === 'INVALID_EVENT_SEQ'), `bad seq ${String(bad)}`);
    assert.deepEqual(graph.statusByNode,{});
    assert.equal(graph.unmatched[0].status,'unknown');
    assert.equal(graph.run.status,'unknown');
    assert.equal(graph.events[1].eventSeq,undefined);
  }
});

test('one malformed run-start or run-end invalidates run and node certainty', () => {
  const goodStart = event('run-start',0,{name:'workflow'});
  const agentStart = event('agent-start',1,{seq:1,label:'A',childId:'child'});
  const agentEnd = event('agent-end',2,{seq:1,outcome:'completed'});
  for (const events of [
    [{...goodStart,seq:undefined},agentStart,agentEnd,event('run-end',3,{stopReason:'completed'})],
    [goodStart,agentStart,agentEnd,event('run-end','3',{stopReason:'completed'})],
  ]) {
    const graph=project(events);
    assert.ok(graph.diagnostics.some(({code}) => code==='INVALID_EVENT_SEQ'));
    assert.deepEqual(graph.statusByNode,{});
    assert.equal(graph.unmatched[0].status,'unknown');
    assert.equal(graph.run.status,'unknown');
  }
});

test('actually absent sequence key, not merely undefined, also fails closed', () => {
  const missing = {type:'tool-workflow/agent-end',time:100,data:{runId:'r',seq:1,outcome:'completed'}};
  const graph=project([start(),missing,runEnd()]);
  assert.ok(graph.diagnostics.some(({code})=>code==='INVALID_EVENT_SEQ'));
  assert.deepEqual(graph.statusByNode,{});
  assert.equal(graph.unmatched[0].status,'unknown');
  assert.equal(graph.run.status,'unknown');
});

test('bad sequencing on one invocation cannot claim certainty on a separate invocation', () => {
  const graph=project([start(),event('agent-start',undefined,{seq:2,label:'B',childId:'other'}),end(7),runEnd()]);
  assert.deepEqual(graph.statusByNode,{});
  assert.ok(graph.unmatched.every(({status})=>status==='unknown'));
});

test('real session numbering allows zero, sparse subsequences and distinct invocation seq', () => {
  const graph=project([event('run-start',0,{name:'r'}),event('agent-start',1,{seq:1,label:'A',childId:'child'}),end(7),runEnd()]);
  assert.equal(graph.run.status,'completed');
  assert.equal(graph.statusByNode.a.status,'completed');
  assert.deepEqual(graph.events.map(({eventSeq}) => eventSeq),[0,1,7,20]);
});

test('malformed foreign-run events do not taint a well-formed run', () => {
  const foreign={...end(undefined),data:{runId:'foreign',seq:1,outcome:'completed'}};
  const graph=project([event('run-start',0,{name:'r'}),event('agent-start',1,{seq:1,label:'A',childId:'child'}),foreign,end(3),runEnd()]);
  assert.equal(graph.run.status,'completed');
  assert.equal(graph.statusByNode.a.status,'completed');
  assert.ok(!graph.diagnostics.some(({code})=>code==='INVALID_EVENT_SEQ'));
});

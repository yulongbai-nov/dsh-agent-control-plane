'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {projectWorkflow}=require('../index.cjs');
const E = (type,data) => ({type:`tool-workflow/${type}`,data:{runId:'r',...data}});
const run = (events) => projectWorkflow({runId:'r',topology:{version:1,complete:true,nodes:[]},layout:{nodes:[],groups:[]},events});

test('start recorded after end never produces a completed invocation in unmatched', () => {
  const graph=run([E('agent-end',{seq:1,outcome:'completed'}),E('agent-start',{seq:1,label:'A',childId:'c'})]);
  assert.equal(graph.unmatched[0].status,'unknown');
});

test('a malformed workflow record invalidates run-end certainty too', () => {
  const graph=run([E('run-start',{name:'r'}),{type:'tool-workflow/agent-start',data:null},E('run-end',{stopReason:'completed'})]);
  assert.equal(graph.run.status,'unknown');
  assert.ok(graph.diagnostics.some(({code})=>code==='INVALID_RUN_ID'));
});

test('a run-start after agent-start is an inconsistent run lifecycle', () => {
  const graph=run([E('agent-start',{seq:1,label:'A',childId:'c'}),E('run-start',{name:'r'}),E('run-end',{stopReason:'completed'})]);
  assert.equal(graph.run.status,'unknown');
  assert.ok(graph.diagnostics.some(({code})=>code==='INVALID_RUN_ORDER'));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {projectWorkflow}=require('../index.cjs');
const E = (type,data) => ({type:`tool-workflow/${type}`,data:{runId:'r',...data}});
const build = (events) => projectWorkflow({runId:'r',topology:{version:1,complete:true,nodes:[{id:'a',kind:'agent',label:'A',phase:null,occurrence:'single'}]},layout:{version:1,nodes:[],groups:[]},sourceBinding:{status:'verified',runId:'r',toolCallId:'tool'},events});

test('durable run-start itself is insufficient to prove current run liveness', () => {
  const graph=build([E('run-start',{name:'same'}),E('agent-start',{seq:1,label:'A',childId:'c'})]);
  assert.equal(graph.run.status,'unknown');
  assert.equal(graph.statusByNode.a.status,'unknown');
});

test('source binding cannot turn invalid topology into a trustworthy unique node', () => {
  const graph=projectWorkflow({runId:'r',topology:{nodes:[{id:'a',kind:'agent',label:'A',phase:null,occurrence:'single'}]},layout:{},sourceBinding:{status:'verified',runId:'r',toolCallId:'tool'},events:[E('agent-start',{seq:1,label:'A',childId:'c'})]});
  assert.deepEqual(graph.statusByNode,{});
  assert.equal(graph.unmatched[0].reason,'incomplete-topology');
});

test('conflicting repeated end records cannot create an observed outcome', () => {
  const graph=build([E('agent-start',{seq:1,label:'A',childId:'c'}),E('agent-end',{seq:1,outcome:'completed'}),E('agent-end',{seq:1,outcome:'failed'})]);
  assert.deepEqual(graph.statusByNode,{});
  assert.equal(graph.unmatched[0].reason,'conflicting-seq');
  assert.equal(graph.unmatched[0].status,'unknown');
});

test('runtime starts with distinct children and same declared label are ambiguous across all of them', () => {
  const graph=build([E('agent-start',{seq:1,label:'A',childId:'c1'}),E('agent-start',{seq:2,label:'A',childId:'c2'})]);
  assert.deepEqual(graph.statusByNode,{});
  assert.equal(graph.unmatched.length,2);
  assert.ok(graph.unmatched.every((entry)=>entry.reason==='ambiguous-runtime'));
});

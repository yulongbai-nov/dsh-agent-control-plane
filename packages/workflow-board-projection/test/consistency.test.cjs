'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectWorkflow: fold } = require('../index.cjs');
const projectWorkflow = (input) => fold({...input, events:input.events.map((event, seq) => ({...event,seq,time:100+seq}))});
const args = () => ({runId:'r',topology:{version:1,complete:true,nodes:[{id:'a',label:'A',kind:'agent',phase:null,occurrence:'single'}]},layout:{version:1,nodes:[],groups:[]},sourceBinding:{status:'verified',runId:'r',toolCallId:'c'},events:[]});
const event = (type,data) => ({type:`tool-workflow/${type}`,data:{runId:'r',...data}});

test('invalid agent-end is not enough to infer a completed node', () => {
  const input = args();
  input.events = [event('agent-start',{seq:1,label:'A',childId:'child'}),event('agent-end',{seq:1,outcome:'invented'})];
  const graph = projectWorkflow(input);
  assert.equal(Object.keys(graph.statusByNode).length,0);
  assert.equal(graph.unmatched[0].reason,'conflicting-seq');
});

test('a repeated event with same invocation seq but conflicting child data is never bound', () => {
  const input = args();
  input.events = [event('agent-start',{seq:1,label:'A',childId:'child'}),event('agent-start',{seq:1,label:'B',childId:'child'})];
  const graph = projectWorkflow(input);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.equal(graph.unmatched[0].reason,'conflicting-seq');
});

test('missing start on any invocation blocks all status matching', () => {
  const input = args();
  input.events = [event('agent-start',{seq:1,label:'A',childId:'child'}),event('agent-end',{seq:3,outcome:'failed'})];
  const graph = projectWorkflow(input);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.ok(graph.unmatched.some((entry) => entry.reason === 'missing-start'));
});

test('object-looking ids cannot modify the status map prototype', () => {
  const input = args();
  input.topology.nodes[0].id='__proto__';
  input.events = [event('agent-start',{seq:1,label:'A',childId:'child'})];
  const graph = projectWorkflow(input);
  assert.equal(Object.getPrototypeOf(graph.statusByNode),Object.prototype);
  assert.ok(Object.hasOwn(graph.statusByNode,'__proto__'));
});

test('same child id on two distinct invocation sequences is contradictory', () => {
  const input = args();
  input.topology.nodes.push({id:'b',label:'B',phase:null,kind:'agent',occurrence:'single'});
  input.events = [event('agent-start',{seq:1,label:'A',childId:'same'}),event('agent-start',{seq:2,label:'B',childId:'same'})];
  const graph = projectWorkflow(input);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
});

test('malformed start without usable runId cannot silently establish unique binding', () => {
  const input = args();
  input.events = [event('agent-start',{seq:1,label:'A',childId:'child'}),{type:'tool-workflow/agent-start',data:{seq:2,label:'A',childId:'other'}}];
  const graph = projectWorkflow(input);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.ok(graph.diagnostics.some(({code}) => code === 'INVALID_RUN_ID'));
});

test('source assertion is data not emitted as proof, no mode or invented summary', () => {
  const input = args();
  input.events=[event('agent-start',{seq:1,label:'A',childId:'child'})];
  const graph=projectWorkflow(input);
  assert.equal(graph.sourceStatus,'verified');
  assert.equal(graph.statusByNode.a.mode,undefined);
  assert.equal(graph.statusByNode.a.parentSessionId,undefined);
  assert.equal(graph.statusByNode.a.status,'unknown');
});

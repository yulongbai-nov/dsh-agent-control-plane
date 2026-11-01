'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {projectWorkflow} = require('../index.cjs');
const ev = (type, data) => ({type:`tool-workflow/${type}`,data:{runId:'r',...data}});
const start = (seq,label,childId) => ev('agent-start',{seq,label,childId});
const end = (seq,outcome) => ev('agent-end',{seq,outcome});
const project = (events) => projectWorkflow({
  runId:'r',events:[ev('run-start',{name:'r'}),...events].map((event, seq) => ({...event,seq,time:100+seq})),sourceBinding:{status:'verified',runId:'r',toolCallId:'call'},
  topology:{complete:true,nodes:[{id:'b',kind:'agent',label:'B',phase:null,occurrence:'single'}]},
  layout:{nodes:[],groups:[]},
});

test('a conflicting seq with another B start blocks the unrelated B binding', () => {
  const graph = project([start(1,'A','a'),start(1,'B','b1'),start(2,'B','b2')]);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.deepEqual(graph.unmatched.map(({seq,reason}) => [seq,reason]),[[1,'conflicting-seq'],[2,'invalid-events']]);
});

test('a duplicate start cannot attribute a single completed end to either child', () => {
  const graph = project([start(1,'A','a1'),start(1,'B','b1'),end(1,'completed')]);
  assert.equal(graph.unmatched[0].reason,'conflicting-seq');
  assert.equal(graph.unmatched[0].status,'unknown');
});

test('duplicate ends stay unknown and block otherwise matching invocations', () => {
  const graph = project([start(1,'A','a'),end(1,'completed'),end(1,'failed'),start(2,'B','b')]);
  assert.equal(graph.unmatched[0].status,'unknown');
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.deepEqual(graph.unmatched.map(({reason}) => reason),['conflicting-seq','invalid-events']);
});

test('normal unique binding survives, later conflict revokes it, clean replay restores it', () => {
  const unique = [start(2,'B','b')];
  assert.equal(project(unique).statusByNode.b.seq,2);
  assert.deepEqual(Object.keys(project([...unique,start(1,'A','a'),start(1,'B','other')]).statusByNode),[]);
  assert.equal(project(unique).statusByNode.b.seq,2);
});

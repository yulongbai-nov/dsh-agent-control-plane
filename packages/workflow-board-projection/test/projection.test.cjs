'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectWorkflow } = require('../index.cjs');
const topology = (nodes, complete = true) => ({version:1, nodes, edges:[], groups:[], phases:[], warnings:[], complete});
const node = (id, label, phase = null, occurrence = 'single') => ({id, kind:'agent', label, phase, occurrence});
const layout = {version:1,nodes:[{id:'a',x:10,y:20}],groups:[]};
const event = (type, data, seq, time) => ({type:`tool-workflow/${type}`, data:{runId:'run-1', ...data}, seq, time});
const run = (nodes, events, options = {}) => projectWorkflow({runId:'run-1',topology:topology(nodes),layout,events,sourceBinding:{status:'verified',runId:'run-1',toolCallId:'call-1'},...options});
const start = (seq, label, phase, childId = `child-${seq}`) => event('agent-start',{seq,label,...(phase === undefined ? {} : {phase}),childId});
const end = (seq,outcome='completed') => event('agent-end',{seq,outcome});

test('folds rc.5 event envelopes and matches unique labeled static sites only', () => {
  const events = [event('run-start',{name:'audit'},1,100), {...start(2,'B','review'),seq:2,time:110}, {...start(1,'A','research'),seq:3,time:120}, {...end(1),seq:4,time:130}, event('run-end',{stopReason:'completed'},5,140)];
  const g = run([node('a','A','research'),node('b','B','review')], events, {parentSessionId:'parent'});
  assert.equal(g.version, 1);
  assert.equal(g.runId, 'run-1');
  assert.equal(g.parentSessionId, 'parent');
  assert.deepEqual(g.run, {name:'audit',status:'completed'});
  assert.equal(g.statusByNode.a.status, 'completed');
  assert.equal(g.statusByNode.a.childId, 'child-1');
  assert.equal(g.statusByNode.b.status, 'unknown');
  assert.equal(g.statusByNode.b.seq, 2);
  assert.deepEqual(g.events.map((e) => [e.eventSeq,e.time,e.seq]), [[1,100,undefined],[2,110,2],[3,120,1],[4,130,1],[5,140,undefined]]);
  assert.deepEqual(g.unmatched, []);
});

test('duplicate labels, runtime collisions and pipeline templates remain unmatched', () => {
  const same = run([node('a','same'),node('b','same')], [start(1,'same')]);
  assert.deepEqual(Object.keys(same.statusByNode), []);
  assert.equal(same.unmatched[0].reason, 'ambiguous-static');
  const repeated = run([node('a','one')], [start(1,'one'),start(2,'one')]);
  assert.deepEqual(Object.keys(repeated.statusByNode), []);
  assert.deepEqual(repeated.unmatched.map((x) => x.reason), ['ambiguous-runtime','ambiguous-runtime']);
  const template = run([node('a','one',null,'template')], [start(1,'one')]);
  assert.deepEqual(Object.keys(template.statusByNode), []);
  assert.equal(template.unmatched[0].reason, 'template');
});

test('different exact phases can disambiguate static nodes', () => {
  const graph = run([node('a','same','p1'),node('b','same','p2')], [start(2,'same','p2')]);
  assert.equal(graph.statusByNode.b.seq,2);
  assert.equal(graph.statusByNode.a,undefined);
  assert.deepEqual(graph.unmatched,[]);
});

test('unknown static labels, phases and incomplete scripts block unsafe proof', () => {
  const unknown = run([node('a','known'),node('b',null)], [start(1,'known')]);
  assert.deepEqual(Object.keys(unknown.statusByNode), []);
  assert.equal(unknown.unmatched[0].reason, 'ambiguous-static');
  const incomplete = run([node('a','known')], [start(1,'known')], {topology:topology([node('a','known')],false)});
  assert.deepEqual(Object.keys(incomplete.statusByNode), []);
  assert.equal(incomplete.unmatched[0].reason, 'incomplete-topology');
});

test('end without start, duplicate/conflicting sequence and foreign runs are not guessed', () => {
  const events = [end(3,'failed'),start(2,'one'),start(2,'one','other'),{...start(4,'foreign'),data:{runId:'different',seq:4,label:'foreign',childId:'wrong'}}];
  const graph = run([node('a','one')], events);
  assert.deepEqual(Object.keys(graph.statusByNode),[]);
  assert.ok(graph.unmatched.some((x) => x.seq===3 && x.reason==='missing-start'));
  assert.ok(graph.unmatched.some((x) => x.seq===2 && x.reason==='conflicting-seq'));
  assert.equal(graph.events.some((e) => e.label === 'foreign'),false);
});

test('layout and topology do not depend on events or mutate caller inputs', () => {
  const originalTopology = topology([node('a','A')]);
  const before = JSON.stringify({originalTopology,layout});
  const a = projectWorkflow({runId:'run-1',topology:originalTopology,layout,events:[]});
  const b = projectWorkflow({runId:'run-1',topology:originalTopology,layout,events:[start(1,'A'),end(1)]});
  assert.deepEqual(a.topology,b.topology);
  assert.deepEqual(a.layout,b.layout);
  assert.equal(JSON.stringify({originalTopology,layout}),before);
});

test('no end or run status inference without actual evidence', () => {
  const g = run([node('a','A')], [start(1,'A')]);
  assert.equal(g.run.status,'unknown');
  assert.equal(g.statusByNode.a.status,'unknown');
});

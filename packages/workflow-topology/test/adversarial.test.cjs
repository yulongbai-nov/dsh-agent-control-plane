'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology } = require('../index.cjs');
const extract = (source) => extractTopology(source, {}, { parse });
const warning = (graph, code) => graph.warnings.some((w) => w.code === code);
const nodeLabels = (graph) => graph.nodes.map((n) => n.label);

test('unknown branch completion never invents an edge to the following node', () => {
  const g = extract(`await parallel([() => agent('known'), args.callback]); await agent('after');`);
  assert.deepEqual(nodeLabels(g), ['known', 'after']);
  assert.deepEqual(g.edges, []);
  assert.ok(warning(g, 'DYNAMIC_CALLBACK'));
});

test('effects inside hook arguments cannot hide calls or set a certain phase', () => {
  const g = extract(`phase('one'); await agent('hello', (change(), { label: 'hello' })); await agent('next');`);
  assert.equal(g.nodes[0].phase, null);
  assert.equal(g.nodes[1].phase, null);
  assert.ok(warning(g, 'DYNAMIC_EFFECT'));
});

test('unsafe arguments break dependency assumptions in both directions', () => {
  const g = extract(`await agent('before'); await agent(fetchPrompt()); await agent('after');`);
  assert.deepEqual(g.edges, []);
  assert.ok(warning(g, 'DYNAMIC_EFFECT'));
});

test('a changed length must not yield an assumed pipeline grid', () => {
  const g = extract(`const xs = [1, 2]; xs.push(3); await pipeline(xs, () => agent('work'));`);
  assert.equal(g.groups[0].expansion, 'template');
  assert.equal(g.nodes[0].occurrence, 'template');
});

test('calls which are hidden in uninvoked lambdas are not invented', () => {
  const g = extract(`const x = () => agent('never'); await agent('certain');`);
  assert.deepEqual(nodeLabels(g), ['certain']);
  assert.ok(warning(g, 'UNSUPPORTED_HOOK_CONTEXT'));
});

test('callback parameter initializers are not skipped as if inert', () => {
  const g = extract(`phase('before'); await parallel([(x = phase('unknown')) => agent('maybe'), () => agent('other')]);`);
  assert.deepEqual(nodeLabels(g), ['other']);
  assert.equal(g.nodes[0].phase, null);
  assert.ok(warning(g, 'DYNAMIC_CALLBACK'));
});

test('callbacks containing break or throw do not create imaginary completion edges', () => {
  const g = extract(`await parallel([async () => { throw Error('x'); await agent('dead'); }, () => agent('live')]); await agent('after');`);
  assert.deepEqual(nodeLabels(g), ['live', 'after']);
});

test('opaque expressions inside arrays or object literals taint the phase and dependency', () => {
  const g = extract(`await agent('before'); const x = [...items]; await agent('after');`);
  assert.deepEqual(g.edges, []);
  assert.ok(warning(g, 'DYNAMIC_EFFECT'));
});

test('global hook rebinding invalidates hook identification', () => {
  for (const assignment of [`globalThis.agent = args.other;`, `const env = globalThis; env.agent = args.other;`, `this.agent = args.other;`]) {
    const g = extract(`${assignment} await agent('not certain');`);
    assert.deepEqual(g.nodes, []);
    assert.ok(warning(g, 'SHADOWED_HOOK'));
  }
});

test('mutating global hook properties through calls is explicitly unresolved', () => {
  for (const source of [`Object.assign(globalThis, {agent: () => 1});`, `Object.defineProperty(globalThis, 'agent', {value: () => 1});`]) {
    const g = extract(`${source} await agent('not certain');`);
    assert.deepEqual(g.nodes, []);
    assert.ok(warning(g, 'SHADOWED_HOOK'));
  }
});

test('dynamic phase invalidates callback and following nodes', () => {
  const g = extract(`phase('before'); await parallel([args.thunk, () => agent('other')]); await agent('after');`);
  assert.deepEqual(g.nodes.map((n) => n.phase), [null, null]);
});

test('thunks with dynamic operations before an agent do not retain stale phase', () => {
  const g = extract(`phase('before'); await parallel([() => { phase('inside'); }, async () => { mystery(); return agent('x'); }]); await agent('after');`);
  assert.deepEqual(g.nodes.map((n) => n.phase), [null, null]);
});

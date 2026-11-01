'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology, layoutTopology } = require('../index.cjs');
const extract = (script) => extractTopology(script, {}, { parse });
const has = (g, code) => g.warnings.some((w) => w.code === code);

test('unknown calls are barriers rather than asserted dependencies', () => {
  const g = extract(`await agent('before'); mystery(); await agent('after');`);
  assert.deepEqual(g.nodes.map((n) => n.label), ['before', 'after']);
  assert.deepEqual(g.edges, []);
  assert.ok(has(g, 'DYNAMIC_EFFECT'));
});

test('nested hooks in log arguments are not ignored or used to guess a phase', () => {
  const g = extract(`phase('before'); log((phase('after'), 'message')); await agent('task');`);
  assert.equal(g.nodes[0].phase, null);
  assert.ok(has(g, 'UNSUPPORTED_HOOK_CONTEXT'));
});

test('nested hooks in agent arguments invalidate the phase of the same call and future calls', () => {
  const g = extract(`phase('before'); await agent((phase('after'), 'prompt')); await agent('later');`);
  assert.deepEqual(g.nodes.map((n) => n.phase), [null, null]);
  assert.ok(has(g, 'UNSUPPORTED_HOOK_CONTEXT'));
});

test('template nodes do not claim a single concrete dependency', () => {
  const g = extract(`await pipeline(args.items, async () => { await agent('one'); return agent('two'); });`);
  assert.deepEqual(g.nodes.map((n) => n.occurrence), ['template', 'template']);
  assert.deepEqual(g.edges, []);
});

test('a top-level return adopts the promise and terminates analysis', () => {
  const g = extract(`return agent('first'); await agent('never');`);
  assert.deepEqual(g.nodes.map((n) => n.label), ['first']);
  assert.equal(has(g, 'UNAWAITED_CALL'), false);
  const thrown = extract(`throw new Error('stop'); await agent('never');`);
  assert.deepEqual(thrown.nodes, []);
});

test('completion edges skip unawaited calls and preserve known empty parallel branches', () => {
  const g = extract(`await agent('before'); const p = agent('slow'); await agent('fast');
    await parallel([() => {}, () => agent('branch')]); await agent('after');`);
  const edgeLabels = g.edges.map(({from, to}) => [g.nodes.find((n) => n.id === from).label, g.nodes.find((n) => n.id === to).label]);
  assert.equal(edgeLabels.some(([from, to]) => from === 'slow' && to === 'fast'), false);
  assert.ok(edgeLabels.some(([from, to]) => from === 'before' && to === 'fast'));
  assert.ok(edgeLabels.some(([from, to]) => from === 'fast' && to === 'after'));
  assert.ok(edgeLabels.some(([from, to]) => from === 'branch' && to === 'after'));
});

test('layout handles an empty graph without a parser or runtime state', () => {
  const graph = { phases: [], nodes: [], edges: [], groups: [] };
  assert.deepEqual(layoutTopology(graph), { version: 1, nodes: [], groups: [] });
});

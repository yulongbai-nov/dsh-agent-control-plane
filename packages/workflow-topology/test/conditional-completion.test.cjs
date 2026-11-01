'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology } = require('../index.cjs');
const extract = (script) => extractTopology(script, {}, { parse });
const labels = (g) => g.edges.map(({ from, to }) => [g.nodes.find((n) => n.id === from).label, g.nodes.find((n) => n.id === to).label]);
const uncertain = (g) => g.warnings.some((w) => w.code === 'UNSUPPORTED_CONTROL_FLOW') && !g.complete;

test('early return in parallel prevents asserting a dependency on a skipped agent', () => {
  const g = extract(`await parallel([async () => {if(args.skip)return; await agent('maybe')}]); await agent('after');`);
  assert.ok(uncertain(g));
  assert.deepEqual(labels(g), []);
});

test('early return in pipeline prevents asserting a dependency on a skipped agent', () => {
  const g = extract(`await pipeline([1], async () => {if(args.skip)return; await agent('maybe')}, () => agent('next'));`);
  assert.ok(uncertain(g));
  assert.deepEqual(labels(g), []);
});

test('unsupported control flow blocks outer entry/exit edges but not later unconditional local sequence', () => {
  const g = extract(`await agent('before'); await parallel([async () => {if(args.skip)return; await agent('maybe'); await agent('next')}]); await agent('after');`);
  assert.ok(uncertain(g));
  assert.deepEqual(labels(g), [['maybe', 'next']]);
});

test('dynamic effects in unsupported control flow invalidate the current phase', () => {
  const g = extract(`const change=phase; phase('old'); if(true) change('new'); await agent('after');`);
  assert.ok(uncertain(g));
  assert.equal(g.nodes.find((node) => node.label === 'after').phase, null);
});

test('an unknown call barrier is preserved even after a later known node', () => {
  const g = extract(`await parallel([async () => {await mystery(); await agent('maybe')}]); await agent('after');`);
  assert.equal(labels(g).some(([from, to]) => from === 'maybe' && to === 'after'), false);
});

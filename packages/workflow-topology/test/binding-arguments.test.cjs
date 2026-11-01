'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology } = require('../index.cjs');
const extract = (script) => extractTopology(script, {}, { parse });
const has = (g, code) => g.warnings.some((w) => w.code === code);

test('destructuring defaults taint later phase and break dependency assumptions', () => {
  const g = extract(`phase('old'); await agent('before'); const {x = phase('new')} = {}; await agent('after');`);
  assert.equal(g.nodes.find((node) => node.label === 'after').phase, null);
  assert.deepEqual(g.edges, []);
  assert.ok(has(g, 'UNSUPPORTED_BINDING_PATTERN'));
  assert.equal(g.complete, false);
});

test('initializer runs before the binding pattern, and later declarations follow it', () => {
  const g = extract(`phase('old'); const {x = phase('new')} = await agent('init'), later = await agent('later');`);
  assert.deepEqual(g.nodes.map((node) => [node.label, node.phase]), [['init', 'old'], ['later', null]]);
  assert.deepEqual(g.edges, []);
  assert.ok(has(g, 'UNSUPPORTED_BINDING_PATTERN'));
});

test('an unmodeled binding breaks dependencies even when its initializer is an agent', () => {
  const g = extract(`const {x} = await agent('first'), later = await agent('later');`);
  assert.deepEqual(g.edges, []);
  assert.ok(has(g, 'UNSUPPORTED_BINDING_PATTERN'));
});

test('the declaration predecessor reaches the initializer before the binding barrier', () => {
  const g = extract(`await agent('before'); const {x} = await agent('first'), later = await agent('later');`);
  assert.deepEqual(g.edges.map(({ from, to }) => [g.nodes.find((n) => n.id === from).label, g.nodes.find((n) => n.id === to).label]), [['before', 'first']]);
});

test('parallel evaluates extra arguments before callbacks', () => {
  const g = extract(`phase('old'); await agent('before'); await parallel([()=>agent('inside')], phase('new')); await agent('after');`);
  assert.equal(g.nodes.find((node) => node.label === 'inside').phase, null);
  assert.equal(g.nodes.find((node) => node.label === 'after').phase, null);
  assert.deepEqual(g.edges, []);
  assert.ok(has(g, 'UNSUPPORTED_EXTRA_ARGUMENTS'));
  assert.equal(g.complete, false);
});

test('extra arguments keep parallel callbacks phase-uncertain even if they change phase', () => {
  const g = extract(`phase('old'); await parallel([() => { phase('first'); }, () => agent('other')], phase('new'));`);
  assert.equal(g.nodes.find((node) => node.label === 'other').phase, null);
  assert.ok(has(g, 'UNSUPPORTED_EXTRA_ARGUMENTS'));
});

test('an explicit later phase restores known state after uncertain evaluation', () => {
  const g = extract(`const [x = phase('unknown')] = []; await parallel([()=>agent('inside')], sideEffect()); phase('known'); await agent('after');`);
  assert.equal(g.nodes.find((node) => node.label === 'after').phase, 'known');
  assert.ok(has(g, 'UNSUPPORTED_BINDING_PATTERN'));
  assert.ok(has(g, 'UNSUPPORTED_EXTRA_ARGUMENTS'));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology } = require('../index.cjs');
const extract = (source) => extractTopology(source, {}, { parse });
const has = (g, code) => g.warnings.some((x) => x.code === code);

test('unknown options must not hide statically certain sibling fields', () => {
  const g = extract(`await agent(item.prompt, {label: item.label, model: 'known', schema: {type:'object'}});`);
  assert.equal(g.nodes[0].label, null);
  assert.equal(g.nodes[0].model, 'known');
  assert.deepEqual(g.nodes[0].schema, {type:'object'});
});

test('parallel callback declarations do not run during construction', () => {
  const g = extract(`const callbacks = [() => agent('inside')]; await parallel(callbacks);`);
  assert.deepEqual(g.nodes, []);
  assert.ok(has(g, 'DYNAMIC_PARALLEL'));
});

test('sequential opaque tail removes dependencies across unresolved work', () => {
  const g = extract(`await parallel([async () => { await agent('first'); await mystery(); }]); await agent('after');`);
  assert.deepEqual(g.edges, []);
  assert.ok(has(g, 'DYNAMIC_EFFECT'));
});

test('unawaited combinator cannot leak callback state to following static node', () => {
  const g = extract(`phase('before'); parallel([async () => { await agent('a'); phase('later'); }]); await agent('b');`);
  assert.equal(g.nodes.find((node) => node.label === 'b').phase, null);
  assert.ok(has(g, 'DYNAMIC_PHASE'));
});

test('optional hook calls are not silently treated as guaranteed', () => {
  const g = extract(`await agent?.('maybe'); await agent('later');`);
  assert.deepEqual(g.nodes.map((node) => node.label), ['later']);
  assert.ok(has(g, 'UNSUPPORTED_HOOK_CONTEXT'));
});

test('invalid meta phase titles and invalid source produce diagnostics', () => {
  const g = extractTopology(`await agent('x');`, {phases:[{title:'a'},{title:'a'},{}]}, {parse});
  assert.ok(has(g, 'DUPLICATE_META_PHASE'));
  assert.ok(has(g, 'INVALID_META_PHASE'));
  assert.ok(has(extract('await {'), 'PARSE_ERROR'));
});

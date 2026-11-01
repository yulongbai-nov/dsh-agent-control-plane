'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology } = require('../index.cjs');
const extract = (script, limits = {}) => extractTopology(script, {}, { parse, limits });
const has = (graph, code) => graph.warnings.some((w) => w.code === code);

test('nested empty pipelines bound all expansion work even when no agent nodes are produced', () => {
  let expression = 'log("done")';
  for (let depth = 0; depth < 5; depth++) expression = `pipeline([1,2,3,4], () => ${expression})`;
  const graph = extract(`await ${expression};`, { maxExpansion: 32 });
  assert.equal(graph.nodes.length, 0);
  assert.ok(has(graph, 'EXPANSION_LIMIT'));
  assert.equal(graph.complete, false);
  assert.ok(graph.groups.length <= 32);
});

test('a dynamic branch may change phase concurrently with sibling awaits', () => {
  const graph = extract(`phase('old'); await parallel([
    async () => { await agent('first'); await agent('second'); },
    () => mystery()
  ]); await agent('after');`);
  assert.deepEqual(graph.nodes.map((node) => node.phase), [null, null, null]);
  assert.ok(has(graph, 'DYNAMIC_PHASE'));
});

test('the same uncertainty holds in a nested parallel used as pipeline stage', () => {
  const graph = extract(`phase('old'); await pipeline([1,2], async () => await parallel([
    async () => { await agent('first'); await agent('second'); }, () => mystery()
  ])); await agent('after');`);
  assert.ok(graph.nodes.every((node) => node.phase === null));
  assert.ok(has(graph, 'DYNAMIC_PHASE'));
});

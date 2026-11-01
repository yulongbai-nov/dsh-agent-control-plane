'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology } = require('../index.cjs');
const extract = (script) => extractTopology(script, {}, {parse});
const has = (graph, code) => graph.warnings.some((w) => w.code === code);

test('invalid async function body does not become a complete valid graph', () => {
  const graph = extract(`const await = 1; await agent('x');`);
  assert.ok(has(graph, 'PARSE_ERROR'));
  assert.equal(graph.complete, false);
  assert.deepEqual(graph.nodes, []);
});

test('async wrapper preserves original source and parse error offsets', () => {
  const script = `// header\nawait agent('x'); return 1;`;
  const graph = extract(script);
  assert.equal(graph.nodes[0].source.start, script.indexOf('agent'));
  assert.equal(script.slice(graph.nodes[0].source.start, graph.nodes[0].source.end), `agent('x')`);
  const invalid = extract(`await agent(`);
  assert.ok(invalid.warnings[0].offset <= `await agent(`.length);
});

test('definite throw aborts item stage chain without a fabricated edge', () => {
  const graph = extract(`await pipeline([1], async () => {await agent('a'); throw 'stop'}, () => agent('never')); await agent('after');`);
  assert.ok(has(graph, 'ABRUPT_COMPLETION'));
  assert.deepEqual(graph.nodes.map((node) => node.label), ['a', 'after']);
  assert.deepEqual(graph.edges, []);
  assert.equal(graph.complete, false);
});

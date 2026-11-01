'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology, layoutTopology } = require('../index.cjs');
const options = { parse, limits: { maxScriptLength: 400, maxAstNodes: 200, maxNodes: 3, maxItems: 2, maxDepth: 3 } };
const has = (g, code) => g.warnings.some((w) => w.code === code);

test('parser and source limits fail closed', () => {
  assert.ok(has(extractTopology('x'.repeat(401), {}, options), 'SCRIPT_LIMIT'));
  assert.ok(has(extractTopology('await agent(', {}, options), 'PARSE_ERROR'));
  assert.ok(has(extractTopology('await agent("x")', {}, {parse: null}), 'PARSER_UNAVAILABLE'));
  assert.ok(has(extractTopology(42, {}, options), 'INVALID_SCRIPT'));
});

test('large AST, graph and item expansion are bounded and warn', () => {
  assert.ok(has(extractTopology('void 0;'.repeat(100), {}, {...options, limits:{maxAstNodes:20}}), 'AST_LIMIT'));
  const graph = extractTopology(`await agent('1'); await agent('2'); await agent('3'); await agent('4');`, {}, options);
  assert.equal(graph.nodes.length, 3);
  assert.ok(has(graph, 'NODE_LIMIT'));
  const pipeline = extractTopology(`await pipeline([1, 2, 3], () => agent('work'));`, {}, options);
  assert.ok(has(pipeline, 'DYNAMIC_PIPELINE_ITEMS'));
  assert.equal(pipeline.groups[0].expansion, 'template');
});

test('analysis handles high branch count when node cap is reached', () => {
  const stages = Array.from({length: 10}, () => `() => agent('x')`).join(',');
  const graph = extractTopology(`await pipeline([1,2], ${stages});`, {}, options);
  assert.equal(graph.nodes.length, 3);
  assert.ok(has(graph, 'NODE_LIMIT'));
  assert.doesNotThrow(() => layoutTopology(graph));
});

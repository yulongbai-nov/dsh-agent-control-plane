'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology } = require('../index.cjs');

const extract = (script) => extractTopology(script, {}, { parse });
function rejected(script) {
  const graph = extract(script);
  assert.equal(graph.complete, false);
  assert.ok(graph.warnings.some(({ code }) => code === 'PARSE_ERROR'));
  assert.deepEqual(graph.nodes, []);
}

test('rejects premature close and extra statements in the async wrapper', () => {
  rejected(`})(); agent('missed'); (async () => {`);
});

test('rejects premature close even if there is only one wrapped expression', () => {
  rejected(`})(), (async () => {`);
});

test('wrapper-like text inside comments and strings remains inert and preserves source offsets', () => {
  const script = `// })(); agent('fake'); (async () => {\nconst text = "})(); agent('also fake'); (async () => {";\nawait agent('real'); // }`;
  const graph = extract(script);
  assert.deepEqual(graph.nodes.map((node) => node.label), ['real']);
  assert.equal(graph.complete, true);
  assert.equal(graph.nodes[0].source.start, script.lastIndexOf('agent'));
  assert.equal(script.slice(graph.nodes[0].source.start, graph.nodes[0].source.end), `agent('real')`);
});

test('a trusted parser throwing null is normalized into PARSE_ERROR', () => {
  const graph = extractTopology('await agent("x")', {}, { parse() { throw null; } });
  assert.equal(graph.complete, false);
  assert.equal(graph.warnings[0].code, 'PARSE_ERROR');
  assert.equal(graph.warnings[0].offset, 0);
});

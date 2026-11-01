'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('acorn');
const { extractTopology, layoutTopology } = require('../index.cjs');
const extract = (source, meta = {}) => extractTopology(source, meta, { parse });

test('noncomputed option keys are not hook references', () => {
  const graph = extract(`await agent('p',{label:'x',phase:'Build'});`);
  assert.equal(graph.complete, true);
  assert.deepEqual(graph.warnings, []);
  assert.equal(graph.nodes[0].phase, 'Build');
});

test('unknown phase column cannot collide with a legal sentinel-like phase name', () => {
  const graph = {
    phases: ['existing'], groups: [],
    nodes: [
      {id:'unknown',phase:null,statementIndex:0},
      {id:'named',phase:'\u0000unknown',statementIndex:1},
    ],
  };
  const layout = layoutTopology(graph);
  assert.notEqual(layout.nodes[0].column, layout.nodes[1].column);
});

test('computed or shorthand hook references remain uncertain', () => {
  for (const expression of [`{[phase('x')]: 1}`, `{phase}`]) {
    const graph = extract(`await agent('p', ${expression});`);
    assert.ok(graph.warnings.some((w) => w.code === 'UNSUPPORTED_HOOK_CONTEXT'));
    assert.equal(graph.complete, false);
  }
});

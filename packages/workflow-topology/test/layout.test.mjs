import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { layoutTopology, extractTopology } = require('../index.cjs')

test('layout is parser-independent, deterministic, and ignores runtime state', () => {
  const graph = { phases: ['Build'], groups: [], nodes: [
    { id: 'b', phase: 'Build', statementIndex: 1, status: 'running' },
    { id: 'a', phase: null, statementIndex: 0, status: 'completed' },
  ] }
  const before = JSON.stringify(graph)
  const original = layoutTopology(graph)
  const changed = structuredClone(graph)
  changed.nodes[0].status = 'failed'
  assert.deepEqual(layoutTopology(changed), original)
  assert.equal(JSON.stringify(graph), before)
  assert.deepEqual(original.nodes.map(({ id, column, row }) => [id, column, row]), [['b', 0, 0], ['a', 1, 1]])
})

test('a missing parser produces a diagnostic without evaluating the script', () => {
  delete globalThis.__workflowTopologyExecuted
  const graph = extractTopology('globalThis.__workflowTopologyExecuted = true', {}, { parse: null })
  assert.deepEqual(graph.nodes, [])
  assert.equal(graph.warnings[0].code, 'PARSER_UNAVAILABLE')
  assert.equal(globalThis.__workflowTopologyExecuted, undefined)
})

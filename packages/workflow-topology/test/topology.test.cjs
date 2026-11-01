'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const { extractTopology, layoutTopology } = require('../index.cjs');

const extract = (script, meta = {}) => extractTopology(script, meta, { parse: acorn.parse });
const labels = (graph) => graph.nodes.map((node) => node.label);
const edges = (graph) => graph.edges.map(({ from, to }) => [
  graph.nodes.find((node) => node.id === from)?.label,
  graph.nodes.find((node) => node.id === to)?.label,
]);
const codes = (graph) => graph.warnings.map((warning) => warning.code);

test('sequence, metadata and phase columns come from the real workflow script body', () => {
  const script = `
    phase('Research');
    const a = await agent('a prompt', { label: 'A', provider: 'codex', model: 'gpt-test', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } });
    log('continue');
    phase('Review');
    const b = await agent('B prompt\\nwith another line');
    return {a, b};
  `;
  const graph = extract(script, { phases: [{ title: 'Review' }, { title: 'Research' }] });
  assert.deepEqual(labels(graph), ['A', 'B prompt']);
  assert.deepEqual(edges(graph), [['A', 'B prompt']]);
  assert.equal(graph.nodes[0].provider, 'codex');
  assert.equal(graph.nodes[0].model, 'gpt-test');
  assert.deepEqual(graph.nodes[0].schema, { type: 'object', properties: { ok: { type: 'boolean' } } });
  assert.equal(graph.nodes[0].phase, 'Research');
  assert.equal(graph.nodes[1].phase, 'Review');
  const layout = layoutTopology(graph);
  assert.equal(layout.nodes.find((n) => n.id === graph.nodes[0].id).column, 1);
  assert.equal(layout.nodes.find((n) => n.id === graph.nodes[1].id).column, 0);
});

test('parallel gives fan-out and fan-in, but not edges between sibling branches', () => {
  const graph = extract(`
    await agent('before', {label:'before'});
    await parallel([
      () => agent('one', {label:'one'}),
      async () => { await agent('two', {label:'two'}); return agent('three', {label:'three'}); },
    ]);
    await agent('after', {label:'after'});
  `);
  assert.deepEqual(labels(graph), ['before', 'one', 'two', 'three', 'after']);
  assert.deepEqual(edges(graph), [
    ['two', 'three'], ['before', 'one'], ['before', 'two'],
    ['one', 'after'], ['three', 'after'],
  ]);
  assert.equal(graph.groups.length, 1);
  assert.equal(graph.groups[0].kind, 'parallel');
  assert.equal(graph.groups[0].members.length, 3);
  assert.ok(layoutTopology(graph).groups[0].bounds);
});

test('pipeline with literal items expands independent per-item chains, not a global barrier', () => {
  const graph = extract(`
    await pipeline(['a', 'b'],
      (prev, item, index) => agent('research', {label:'research'}),
      (prev, item, index) => agent('review', {label:'review'}));
    await agent('done', {label:'done'});
  `);
  assert.deepEqual(labels(graph), ['research', 'review', 'research', 'review', 'done']);
  assert.deepEqual(edges(graph), [
    ['research', 'review'], ['research', 'review'], ['review', 'done'], ['review', 'done'],
  ]);
  assert.deepEqual(graph.nodes.slice(0, 4).map(({ itemIndex, stageIndex }) => [itemIndex, stageIndex]), [[0,0],[0,1],[1,0],[1,1]]);
  assert.equal(graph.groups[0].kind, 'pipeline');
  assert.equal(graph.groups[0].expansion, 'expanded');
  assert.ok(codes(graph).includes('AMBIGUOUS_LABEL'));
  assert.equal(new Set(graph.nodes.map((n) => n.id)).size, 5);
});

test('unknown item count is an explicitly dynamic call-site template, never an expanded grid', () => {
  const graph = extract(`
    await pipeline(args.items, (prev, item) => agent(item.prompt, {label: item.label}),
      (prev, item) => agent('review', {label:'review'}));
    await agent('done', {label:'done'});
  `);
  assert.equal(graph.groups[0].expansion, 'template');
  assert.equal(graph.groups[0].itemCount, null);
  assert.deepEqual(graph.nodes.map((n) => n.occurrence), ['template', 'template', 'single']);
  assert.equal(graph.nodes[0].label, null);
  assert.ok(codes(graph).includes('DYNAMIC_PIPELINE_ITEMS'));
  assert.ok(codes(graph).includes('DYNAMIC_AGENT_LABEL'));
  assert.deepEqual(edges(graph), []);
});

test('unawaited calls are not turned into completion edges', () => {
  const graph = extract(`
    agent('first', {label:'first'});
    agent('second', {label:'second'});
    await agent('third', {label:'third'});
    await agent('fourth', {label:'fourth'});
  `);
  assert.deepEqual(labels(graph), ['first', 'second', 'third', 'fourth']);
  assert.deepEqual(edges(graph), [['third', 'fourth']]);
  assert.ok(codes(graph).includes('UNAWAITED_CALL'));
});

test('unsupported dynamic control and closures warn rather than invent nodes', () => {
  const graph = extract(`
    if (args.yes) await agent('maybe', {label:'maybe'});
    for (const item of args.items) await agent(item);
    const later = () => agent('not called');
    await agent('known', {label:'known'});
  `);
  assert.deepEqual(labels(graph), ['known']);
  assert.ok(codes(graph).includes('UNSUPPORTED_CONTROL_FLOW'));
  assert.ok(codes(graph).includes('UNSUPPORTED_HOOK_CONTEXT'));
});

test('shadowed hooks and dynamic options are not misidentified as known metadata', () => {
  const shadowed = extract(`const agent = args.fn; await agent('not a workflow agent');`);
  assert.deepEqual(shadowed.nodes, []);
  assert.ok(codes(shadowed).includes('SHADOWED_HOOK'));
  const dynamic = extract(`await agent('prompt', {label:'safe', ...args.options});`);
  assert.equal(dynamic.nodes[0].label, null);
  assert.equal(dynamic.nodes[0].provider, null);
  assert.ok(codes(dynamic).includes('DYNAMIC_AGENT_OPTIONS'));
});

test('dynamic phase in parallel invalidates global phase assumptions', () => {
  const graph = extract(`
    phase('one');
    await parallel([async () => { phase('two'); await agent('x', { label: 'x' }); },
      () => agent('y', { label: 'y' })]);
    await agent('z', { label: 'z' });
  `, { phases: [{title:'one'}, {title:'two'}] });
  assert.ok(codes(graph).includes('DYNAMIC_PHASE'));
  assert.equal(graph.nodes.find((n) => n.label === 'y').phase, null);
  assert.equal(graph.nodes.find((n) => n.label === 'z').phase, null);
});

test('parsing never executes source and handles malformed source safely', () => {
  delete globalThis.__workflowTopologyExecuted;
  const graph = extract(`globalThis.__workflowTopologyExecuted = true; await agent('hi');`);
  assert.equal(globalThis.__workflowTopologyExecuted, undefined);
  assert.deepEqual(labels(graph), ['hi']);
  const invalid = extract(`await agent(`);
  assert.deepEqual(invalid.nodes, []);
  assert.ok(codes(invalid).includes('PARSE_ERROR'));
});

test('layout is byte-deterministic, independent of runtime status, and leaves inputs untouched', () => {
  const script = `phase('x'); await parallel([() => agent('A'), () => agent('B')]);`;
  const meta = { phases: [{title:'x'}] };
  const graph = extract(script, meta);
  const before = JSON.stringify(graph);
  const first = JSON.stringify(layoutTopology(graph));
  assert.equal(first, JSON.stringify(layoutTopology(extract(script, meta))));
  assert.equal(JSON.stringify(graph), before);
  const withEvents = structuredClone(graph);
  withEvents.nodes[0].status = 'failed';
  withEvents.nodes[1].status = 'running';
  assert.equal(first, JSON.stringify(layoutTopology(withEvents)));
});

test('a top-level return prevents later call-sites from appearing', () => {
  const graph = extract(`await agent('first'); return {}; await agent('unreachable');`);
  assert.deepEqual(labels(graph), ['first']);
});

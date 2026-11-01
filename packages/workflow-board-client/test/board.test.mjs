import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createWorkflowBoard, navigationTarget } from '../index.mjs';
const require = createRequire(import.meta.url);
const { layoutTopology } = require('../../workflow-topology/index.cjs');

const graph = {
  version: 1, complete: true, phases: ['one', 'two'], warnings: [],
  nodes: [
    { id: 'a', kind: 'agent', label: 'first', phase: 'one', model: 'luna', statementIndex: 0, occurrence: 'single' },
    { id: 'b', kind: 'agent', label: 'second', phase: 'two', model: null, statementIndex: 1, occurrence: 'single' },
    { id: 'c', kind: 'agent', label: 'third', phase: 'two', model: 'terra', statementIndex: 2, occurrence: 'single' }
  ],
  edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }],
  groups: [{ id: 'parallel@10', kind: 'parallel', members: ['b', 'c'] }]
};
const makeBoard = () => ({ version: 1, runId: 'run-A', sourceStatus: 'verified', parentSessionId: 'parent-real', run: { status: 'unknown' },
  topology: structuredClone(graph), layout: layoutTopology(graph), statusByNode: {}, unmatched: [], events: [], diagnostics: [] });
const sampleData = () => ({ byId: { child: { id: 'child', parentId: 'parent-real', running: true } },
  projectionsBySession: { child: { values: { subagent: { mode: 'one-shot' } } } } });

function renderer({ strict = false } = {}) {
  let state = [], cursor = 0, dirty = false, mounted = true, updatesAfterUnmount = 0;
  let effects = [], pending = [];
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useId: () => ':test-board:',
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], next => {
        if (!mounted) { updatesAfterUnmount++; return; }
        const value = typeof next === 'function' ? next(state[index]) : next;
        if (!Object.is(value, state[index])) { state[index] = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect(callback, deps) {
      const index = cursor++, previous = effects[index];
      if (!previous || !deps || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i]))) pending.push({ index, callback, deps });
    },
    useLayoutEffect(callback, deps) {
      const index = cursor++, previous = effects[index];
      if (!previous || !deps || deps.some((dep, i) => !Object.is(dep, previous.deps?.[i]))) pending.push({ index, callback, deps });
    }
  };
  const Component = createWorkflowBoard(React);
  const render = props => {
    let result, passes = 0;
    do {
      if (++passes > 20) throw new Error('effect/render loop');
      dirty = false; cursor = 0; pending = [];
      result = Component(props);
      for (const effect of pending) {
        const first = !effects[effect.index];
        effects[effect.index]?.cleanup?.();
        let cleanup = effect.callback();
        if (strict && first) { cleanup?.(); cleanup = effect.callback(); }
        effects[effect.index] = { deps: effect.deps, cleanup };
      }
    } while (dirty);
    return result;
  };
  const unmount = () => { for (const effect of effects) effect?.cleanup?.(); mounted = false; };
  return { render, unmount, updatesAfterUnmount: () => updatesAfterUnmount };
}
const flatten = node => node && typeof node === 'object' ? [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)] : [];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? (node.children ?? []).flat(Infinity).map(text).join('') : '';
const nodesOf = tree => flatten(tree).filter(node => node.props?.['data-node-id'] && node.props?.role === 'button');
const rowsOf = tree => flatten(tree).filter(node => node.props?.['data-roster-id']);
const svgOf = tree => flatten(tree).find(node => node.type === 'svg');

test('status overlays never change graph geometry or static order', () => {
  const board = makeBoard(), { render } = renderer();
  const before = structuredClone(board);
  const first = render({ board, sessions: sampleData(), statuses: new Map(), openSession() {} });
  assert.deepEqual(board, before);
  board.statusByNode.b = { status: 'completed', seq: 5, childId: 'child', label: 'second', phase: 'two' };
  const second = render({ board, sessions: sampleData(), statuses: new Map(), openSession() {} });
  const geometry = tree => nodesOf(tree).map(n => [n.props['data-node-id'], n.props.transform]);
  assert.deepEqual(geometry(first), geometry(second));
  assert.deepEqual(geometry(first), board.layout.nodes.map(node => [node.id, `translate(${node.x} ${node.y})`]));
  assert.equal(flatten(second).filter(n => n.type === 'path' && n.props['data-edge']).length, 2);
  assert.equal(flatten(second).filter(n => n.props['data-group-id']).length, 1);
  assert.equal(svgOf(first).props.viewBox, svgOf(second).props.viewBox);
  assert.ok(text(second).includes('已完成'));
});

test('graph and roster select same node, filters do not rearrange graph', () => {
  const board = makeBoard(), r = renderer();
  board.statusByNode.b = { status: 'failed', seq: 7, label: 'second', childId: 'child' };
  const props = { board, sessions: sampleData(), statuses: new Map(), openSession() {} };
  let tree = r.render(props);
  nodesOf(tree).find(n => n.props['data-node-id'] === 'b').props.onClick();
  tree = r.render(props);
  assert.equal(rowsOf(tree).find(n => n.props['data-roster-id'] === 'b').props['data-selected'], true);
  rowsOf(tree).find(n => n.props['data-roster-id'] === 'a').props.onClick();
  tree = r.render(props);
  assert.equal(nodesOf(tree).find(n => n.props['data-node-id'] === 'a').props['aria-pressed'], true);
  const positions = nodesOf(tree).map(n => n.props.transform);
  const statusFilter = flatten(tree).find(n => n.type === 'select' && n.props['aria-label'] === '按状态筛选');
  statusFilter.props.onChange({ target: { value: 'failed' } });
  tree = r.render(props);
  assert.deepEqual(rowsOf(tree).map(n => n.props['data-roster-id']), ['b']);
  assert.deepEqual(nodesOf(tree).map(n => n.props.transform), positions);
  flatten(tree).find(n => n.type === 'select' && n.props['aria-label'] === '按状态筛选').props.onChange({ target: { value: '' } });
  tree = r.render(props);
  flatten(tree).find(n => n.type === 'select' && n.props['aria-label'] === '按阶段筛选').props.onChange({ target: { value: 'two' } });
  tree = r.render(props);
  assert.deepEqual(rowsOf(tree).map(n => n.props['data-roster-id']), ['b', 'c']);
  flatten(tree).find(n => n.type === 'select' && n.props['aria-label'] === '按模型筛选').props.onChange({ target: { value: 'terra' } });
  tree = r.render(props);
  assert.deepEqual(rowsOf(tree).map(n => n.props['data-roster-id']), ['c']);
});

test('filters are scoped to run and parent, but survive status updates within one run', () => {
  const board = makeBoard(), r = renderer();
  board.statusByNode.c = { status: 'failed', seq: 1, childId: 'child' };
  const props = { board, sessions: sampleData(), statuses: new Map(), openSession() {} };
  const filter = (tree, name) => flatten(tree).find(node => node.type === 'select' && node.props['aria-label'] === name);
  let tree = r.render(props);
  for (const [name, value] of [['按状态筛选', 'failed'], ['按阶段筛选', 'two'], ['按模型筛选', 'terra']]) {
    filter(tree, name).props.onChange({ target: { value } }); tree = r.render(props);
  }
  assert.deepEqual(rowsOf(tree).map(row => row.props['data-roster-id']), ['c']);
  rowsOf(tree)[0].props.onClick();
  tree = r.render(props);
  const refreshed = { ...board, statusByNode: { ...board.statusByNode, c: { ...board.statusByNode.c, status: 'running' } } };
  tree = r.render({ ...props, board: refreshed });
  assert.deepEqual(['按状态筛选', '按阶段筛选', '按模型筛选'].map(name => filter(tree, name).props.value), ['failed', 'two', 'terra']);
  assert.deepEqual(rowsOf(tree), []);
  assert.equal(nodesOf(tree).find(node => node.props['data-node-id'] === 'c').props['aria-pressed'], true);
  const otherRun = { ...board, runId: 'run-B' };
  otherRun.topology = { ...board.topology, nodes: board.topology.nodes.map(node => ({ ...node, phase: 'new-phase', model: 'new-model' })) };
  tree = r.render({ ...props, board: otherRun });
  assert.deepEqual(['按状态筛选', '按阶段筛选', '按模型筛选'].map(name => filter(tree, name).props.value), ['', '', '']);
  assert.equal(rowsOf(tree).length, 3);
  assert.equal(rowsOf(tree).some(row => row.props['data-selected']), false);
  filter(tree, '按阶段筛选').props.onChange({ target: { value: 'new-phase' } });
  tree = r.render({ ...props, board: otherRun });
  const otherParent = { ...otherRun, parentSessionId: 'another-parent' };
  tree = r.render({ ...props, board: otherParent });
  assert.equal(filter(tree, '按阶段筛选').props.value, '');
  assert.equal(rowsOf(tree).length, 3);
});

test('removed phase and model options fall back without changing fixed status filter', () => {
  const board = makeBoard(), r = renderer();
  board.statusByNode.c = { status: 'failed', seq: 1 };
  const props = { board };
  const filter = (tree, name) => flatten(tree).find(node => node.type === 'select' && node.props['aria-label'] === name);
  let tree = r.render(props);
  for (const [name, value] of [['按状态筛选', 'failed'], ['按阶段筛选', 'two'], ['按模型筛选', 'terra']]) {
    filter(tree, name).props.onChange({ target: { value } }); tree = r.render(props);
  }
  const next = { ...board, topology: { ...board.topology, nodes: board.topology.nodes.map(node => ({ ...node, phase: 'different', model: 'new' })) } };
  tree = r.render({ board: next });
  assert.deepEqual(['按状态筛选', '按阶段筛选', '按模型筛选'].map(name => filter(tree, name).props.value), ['failed', '', '']);
  assert.deepEqual(rowsOf(tree).map(node => node.props['data-roster-id']), ['c']);
  tree = r.render({ board });
  assert.deepEqual(['按状态筛选', '按阶段筛选', '按模型筛选'].map(name => filter(tree, name).props.value), ['failed', '', '']);
  assert.deepEqual(rowsOf(tree).map(node => node.props['data-roster-id']), ['c']);
});

test('navigate only when rc.5 live member, identity and actual parent agree', () => {
  const board = makeBoard(), sessions = sampleData(), statuses = new Map([['child', { running: true }]]);
  const member = { status: 'running', childId: 'child' };
  assert.deepEqual(navigationTarget(board, member, sessions, statuses), { parentSessionId: 'parent-real', childSessionId: 'child', mode: 'one-shot' });
  assert.equal(navigationTarget({ ...board, sourceStatus: 'unverified' }, member, sessions, statuses), null);
  assert.equal(navigationTarget({ ...board, topology: { ...board.topology, complete: false } }, member, sessions, statuses), null);
  assert.equal(navigationTarget({ ...board, parentSessionId: undefined }, member, sessions, statuses), null);
  assert.equal(navigationTarget({ ...board, parentSessionId: 'root-not-parent' }, member, sessions, statuses), null);
  assert.equal(navigationTarget(board, { ...member, status: 'completed' }, sessions, statuses), null);
  assert.equal(navigationTarget(board, { ...member, status: 'unknown' }, sessions, statuses), null);
  assert.equal(navigationTarget(board, member, sessions, new Map([['child', { running: false }]])), null);
  assert.equal(navigationTarget(board, member, { ...sessions, projectionsBySession: {} }, statuses), null);
  assert.equal(navigationTarget(board, member, { ...sessions, projectionsBySession: { child: { values: { subagent: { mode: 'external' } } } } }, statuses), null);
  assert.equal(navigationTarget(board, member, { ...sessions, projectionsBySession: { child: { values: { subagent: { mode: 'unknown' } } } } }, statuses), null);
});

test('UI navigation uses validated parent and refuses ambiguous or unavailable child', () => {
  const board = makeBoard(), r = renderer(), calls = [];
  board.statusByNode.a = { status: 'running', childId: 'child', seq: 1 };
  const props = { board, sessions: sampleData(), statuses: new Map([['child', { running: true }]]), openSession: target => calls.push(target) };
  let tree = r.render(props);
  rowsOf(tree).find(row => row.props['data-roster-id'] === 'a').props.onClick();
  tree = r.render(props);
  const button = flatten(tree).find(node => node.type === 'button' && text(node) === '打开子会话');
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.deepEqual(calls, [{ parentSessionId: 'parent-real', childSessionId: 'child', mode: 'one-shot' }]);
  props.sessions = { ...props.sessions, byId: { child: { parentId: 'wrong', running: true } } };
  tree = r.render(props);
  assert.equal(flatten(tree).find(node => node.type === 'button' && text(node) === '打开子会话').props.disabled, true);
});

test('a retained selection never opens a same-id node in another run', () => {
  const board = makeBoard(), r = renderer(), calls = [];
  board.statusByNode.a = { status: 'running', childId: 'child', seq: 1 };
  const props = { board, sessions: sampleData(), statuses: new Map([['child', { running: true }]]), openSession: target => calls.push(target) };
  let tree = r.render(props);
  rowsOf(tree)[0].props.onClick();
  tree = r.render(props);
  assert.equal(flatten(tree).find(node => node.type === 'button' && text(node) === '打开子会话').props.disabled, false);
  const second = { ...board, runId: 'run-B', parentSessionId: 'other-parent' };
  tree = r.render({ ...props, board: second });
  assert.equal(rowsOf(tree).some(row => row.props['data-selected']), false);
  assert.equal(flatten(tree).some(node => node.type === 'button' && text(node) === '打开子会话'), false);
  assert.deepEqual(calls, []);
});

test('navigation errors are scoped to node, run, parent, latest attempt and mounted lifetime', async () => {
  const board = makeBoard(), r = renderer(), calls = [];
  board.statusByNode.a = { status: 'running', childId: 'child', seq: 1 };
  board.statusByNode.b = { status: 'running', childId: 'child', seq: 2 };
  const props = { board, sessions: sampleData(), statuses: new Map([['child', { running: true }]]), openSession: () => new Promise((resolve, reject) => calls.push({ resolve, reject })) };
  const row = (tree, id) => rowsOf(tree).find(item => item.props['data-roster-id'] === id);
  const open = tree => flatten(tree).find(node => node.type === 'button' && text(node) === '打开子会话');
  const alert = tree => flatten(tree).find(node => node.props?.role === 'alert');
  let tree = r.render(props);
  row(tree, 'a').props.onClick(); tree = r.render(props);
  open(tree).props.onClick();
  row(tree, 'b').props.onClick(); tree = r.render(props);
  calls[0].reject(new Error('late a')); await new Promise(resolve => setImmediate(resolve));
  tree = r.render(props); assert.equal(alert(tree), undefined);
  open(tree).props.onClick(); calls[1].reject(new Error('b failed')); await new Promise(resolve => setImmediate(resolve));
  tree = r.render(props); assert.ok(text(alert(tree)).includes('b failed'));
  open(tree).props.onClick(); tree = r.render(props); assert.equal(alert(tree), undefined);
  calls[2].resolve(); await new Promise(resolve => setImmediate(resolve));
  tree = r.render(props); assert.equal(alert(tree), undefined);
  open(tree).props.onClick(); open(tree).props.onClick();
  calls[3].reject(new Error('old attempt')); await new Promise(resolve => setImmediate(resolve));
  tree = r.render(props); assert.equal(alert(tree), undefined);
  calls[4].reject(new Error('latest attempt')); await new Promise(resolve => setImmediate(resolve));
  tree = r.render(props); assert.ok(text(alert(tree)).includes('latest attempt'));
  row(tree, 'a').props.onClick(); tree = r.render(props); assert.equal(alert(tree), undefined);
  open(tree).props.onClick();
  const otherRun = { ...board, runId: 'run-B' };
  tree = r.render({ ...props, board: otherRun });
  calls[5].reject(new Error('wrong run')); await new Promise(resolve => setImmediate(resolve));
  tree = r.render({ ...props, board: otherRun }); assert.equal(alert(tree), undefined);
  row(tree, 'a').props.onClick(); tree = r.render({ ...props, board: otherRun });
  open(tree).props.onClick();
  const otherParent = { ...otherRun, parentSessionId: 'parent-2' };
  tree = r.render({ ...props, board: otherParent });
  calls[6].reject(new Error('wrong parent')); await new Promise(resolve => setImmediate(resolve));
  tree = r.render({ ...props, board: otherParent }); assert.equal(alert(tree), undefined);
  tree = r.render({ ...props, board: otherRun }); row(tree, 'b').props.onClick(); tree = r.render({ ...props, board: otherRun });
  open(tree).props.onClick();
  r.unmount(); calls[7].reject(new Error('after unmount')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.updatesAfterUnmount(), 0);
});

test('displayed error is permanently cleared after run or parent switches away and back', async () => {
  const board = makeBoard(), r = renderer();
  board.statusByNode.a = { status: 'running', childId: 'child', seq: 1 };
  let reject;
  const props = { board, sessions: sampleData(), statuses: new Map([['child', { running: true }]]), openSession: () => new Promise((_resolve, fail) => { reject = fail; }) };
  const alert = tree => flatten(tree).find(node => node.props?.role === 'alert');
  const open = tree => flatten(tree).find(node => node.type === 'button' && text(node) === '打开子会话');
  async function showError(message) {
    let tree = r.render(props);
    rowsOf(tree).find(row => row.props['data-roster-id'] === 'a').props.onClick();
    tree = r.render(props);
    open(tree).props.onClick(); reject(new Error(message));
    await new Promise(resolve => setImmediate(resolve));
    tree = r.render(props);
    assert.ok(text(alert(tree)).includes(message));
  }
  await showError('first run error');
  let tree = r.render({ ...props, board: { ...board, runId: 'other-run' } });
  assert.equal(alert(tree), undefined);
  tree = r.render(props);
  assert.equal(alert(tree), undefined);
  await showError('first parent error');
  tree = r.render({ ...props, board: { ...board, parentSessionId: 'other-parent' } });
  assert.equal(alert(tree), undefined);
  tree = r.render(props);
  assert.equal(alert(tree), undefined);
});

test('strict-mode effect replay keeps navigation functional and clears old error across scopes', async () => {
  const board = makeBoard(), r = renderer({ strict: true });
  board.statusByNode.a = { status: 'running', childId: 'child', seq: 1 };
  const props = { board, sessions: sampleData(), statuses: new Map([['child', { running: true }]]), openSession: () => Promise.reject(new Error('strict failure')) };
  let tree = r.render(props);
  rowsOf(tree).find(row => row.props['data-roster-id'] === 'a').props.onClick();
  tree = r.render(props);
  flatten(tree).find(node => node.type === 'button' && text(node) === '打开子会话').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = r.render(props);
  assert.ok(flatten(tree).some(node => node.props?.role === 'alert' && text(node).includes('strict failure')));
  r.render({ ...props, board: { ...board, runId: 'second' } });
  tree = r.render(props);
  assert.equal(flatten(tree).some(node => node.props?.role === 'alert'), false);
});

test('navigation rejection after a newer scope commits cannot update obsolete state', async () => {
  const board = makeBoard();
  board.statusByNode.a = { status: 'running', childId: 'child', seq: 1 };
  let pending = [], states = [], cursor = 0, updates = 0, reject;
  const React = {
    Fragment: Symbol('fragment'), useId: () => ':gap:',
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { updates++; states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useLayoutEffect(callback) { pending.push(callback); },
    useEffect(callback) { pending.push(callback); }
  };
  const Component = createWorkflowBoard(React);
  const props = { board, sessions: sampleData(), statuses: new Map([['child', { running: true }]]), openSession: () => new Promise((_resolve, fail) => { reject = fail; }) };
  function render(value) { cursor = 0; pending = []; return Component(value); }
  let tree = render(props); pending.forEach(effect => effect());
  rowsOf(tree)[0].props.onClick(); tree = render(props); pending.forEach(effect => effect());
  flatten(tree).find(node => node.type === 'button' && text(node) === '打开子会话').props.onClick();
  render({ ...props, board: { ...board, runId: 'run-B' } });
  pending.slice(0, 1).forEach(effect => effect()); // commit layout effect, before passive effects
  const before = updates;
  reject(new Error('obsolete')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates, before);
});

test('keyboard selected node exposes direct predecessor and successor in both locales', () => {
  const r = renderer(), board = makeBoard();
  board.topology.nodes[1].label = null;
  board.topology.edges = [{ from: 'a', to: 'b' }];
  const props = { board, sessions: sampleData(), statuses: new Map() };
  let tree = r.render(props);
  const a = nodesOf(tree).find(node => node.props['data-node-id'] === 'a');
  assert.ok(a.props['aria-label'].includes('后继'));
  assert.ok(a.props['aria-label'].includes('未命名节点'));
  assert.ok(nodesOf(tree).find(node => node.props['data-node-id'] === 'c').props['aria-label'].includes('无'));
  let prevented = false;
  a.props.onKeyDown({ key: ' ', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  tree = r.render(props);
  const detail = flatten(tree).find(node => node.props?.['aria-label'] === '所选节点');
  assert.ok(text(detail).includes('后继'));
  assert.ok(text(detail).includes('未命名节点'));
  const b = nodesOf(tree).find(node => node.props['data-node-id'] === 'b');
  assert.ok(b.props['aria-label'].includes('前驱'));
  assert.ok(b.props['aria-label'].includes('first'));
  const english = r.render({ ...props, locale: 'en' });
  const englishA = nodesOf(english).find(node => node.props['data-node-id'] === 'a');
  assert.ok(englishA.props['aria-label'].includes('Successors'));
  assert.ok(englishA.props['aria-label'].includes('Unnamed node'));
  const noEdge = { ...board, topology: { ...board.topology, edges: [] } };
  const without = r.render({ ...props, board: noEdge, locale: 'en' });
  assert.ok(nodesOf(without)[0].props['aria-label'].includes('Successors: None'));
  assert.notEqual(nodesOf(without)[0].props['aria-label'], englishA.props['aria-label']);
  const incomplete = { ...noEdge, topology: { ...noEdge.topology, complete: false } };
  const uncertain = r.render({ ...props, board: incomplete, locale: 'en' });
  assert.ok(nodesOf(uncertain)[0].props['aria-label'].includes('Successors: Not determined'));
});

test('events preserve input order and unknown/unmatched fields are never invented', () => {
  const board = makeBoard(), r = renderer();
  board.events = [
    { type: 'tool-workflow/agent-start', runId: 'run-A', eventSeq: 20, time: 1000, seq: 9, label: 'a', childId: 'child' },
    { type: 'tool-workflow/agent-start', runId: 'run-A', eventSeq: 21, time: 1001, seq: 2, label: 'b', childId: 'child2' },
    { type: 'tool-workflow/agent-end', runId: 'run-A', eventSeq: 22, time: 1002, seq: 9, outcome: 'completed' }
  ];
  board.unmatched = [{ seq: 2, label: 'b', childId: 'child2', status: 'unknown', reason: 'source-unverified' }];
  board.topology.complete = false;
  board.diagnostics = [{ code: 'SOURCE_UNVERIFIED', message: '来源未验证' }];
  const tree = r.render({ board, sessions: sampleData(), statuses: new Map(), openSession() {} });
  const events = flatten(tree).filter(n => n.props?.['data-event-index'] !== undefined);
  assert.deepEqual(events.map(n => n.props['data-event-index']), [0, 1, 2]);
  assert.deepEqual(events.map(n => n.props['data-event-seq']), [20, 21, 22]);
  assert.ok(text(tree).includes('source-unverified'));
  assert.ok(text(tree).includes('来源未验证'));
  assert.ok(text(tree).includes('不完整'));
  assert.ok(text(tree).includes('未知'));
  assert.ok(!text(tree).includes('等待'));
});

test('renders actual topology and real event projection without fabricating bindings', () => {
  const { projectWorkflow } = require('../../workflow-board-projection/index.cjs');
  const events = [
    { type: 'tool-workflow/run-start', seq: 1, time: 100, data: { runId: 'actual', name: 'audit' } },
    { type: 'tool-workflow/agent-start', seq: 2, time: 110, data: { runId: 'actual', seq: 3, label: 'first', phase: 'one', childId: 'child' } },
    { type: 'tool-workflow/agent-end', seq: 3, time: 120, data: { runId: 'actual', seq: 3, outcome: 'completed' } }
  ];
  const board = projectWorkflow({ runId: 'actual', topology: graph, layout: layoutTopology(graph), events, parentSessionId: 'parent-real' });
  const r = renderer(), tree = r.render({ board, sessions: sampleData(), statuses: new Map(), openSession() {} });
  assert.equal(board.sourceStatus, 'unverified');
  assert.equal(board.unmatched[0].reason, 'source-unverified');
  assert.deepEqual(Object.keys(board.statusByNode), []);
  assert.ok(text(tree).includes('来源未验证'));
  assert.ok(text(tree).includes('source-unverified'));
  assert.equal(nodesOf(tree)[0].props['aria-label'].includes('未知'), true);
  assert.deepEqual(flatten(tree).filter(n => n.props?.['data-event-index'] !== undefined).map(n => n.props['data-event-seq']), [1, 2, 3]);
  const verified = projectWorkflow({ runId: 'actual', topology: graph, layout: layoutTopology(graph), events, parentSessionId: 'parent-real',
    sourceBinding: { status: 'verified', runId: 'actual', toolCallId: 'call' } });
  assert.equal(verified.statusByNode.a.status, 'completed');
  const verifiedTree = r.render({ board: verified, sessions: sampleData(), statuses: new Map(), openSession() {} });
  assert.ok(nodesOf(verifiedTree)[0].props['aria-label'].includes('已完成'));
});

test('graph labels are clipped and unmatched diagnostics expose durable identity', () => {
  const { render } = renderer(), board = makeBoard();
  board.topology.nodes[0].label = 'long '.repeat(1000);
  board.unmatched = [{ seq: 8, childId: 'session-8', phase: 'phase-B', status: 'unknown', reason: 'ambiguous-runtime' }];
  const tree = render({ board });
  const graph = svgOf(tree);
  assert.ok(flatten(graph).some(node => node.type === 'clipPath'));
  assert.ok(text(tree).includes('session-8'));
  assert.ok(text(tree).includes('phase-B'));
  assert.ok(text(tree).includes('8'));
});

test('snapshot status only overlays a verified, complete, unambiguous static node', () => {
  const { render } = renderer(), board = makeBoard();
  board.statusByNode.a = { status: 'completed', childId: 'child' };
  board.sourceStatus = 'unverified';
  let tree = render({ board });
  assert.ok(nodesOf(tree)[0].props['aria-label'].includes('未知'));
  assert.ok(!nodesOf(tree)[0].props['aria-label'].includes('已完成'));
  board.sourceStatus = 'verified'; board.topology.complete = false;
  tree = render({ board });
  assert.ok(nodesOf(tree)[0].props['aria-label'].includes('未知'));
  board.topology.complete = true; board.topology.nodes[0].occurrence = 'template';
  tree = render({ board });
  assert.ok(nodesOf(tree)[0].props['aria-label'].includes('未知'));
  board.topology.nodes[0].occurrence = 'single';
  board.topology.nodes.push({ ...board.topology.nodes[0] });
  tree = render({ board });
  assert.ok(nodesOf(tree)[0].props['aria-label'].includes('未知'));
});

test('malformed geometry cannot inject nonfinite coordinates or broken edges', () => {
  const { render } = renderer(), board = makeBoard();
  board.layout.nodes[0].width = -1;
  board.layout.nodes[1].x = NaN;
  const tree = render({ board });
  assert.equal(nodesOf(tree).some(node => node.props['data-node-id'] === 'a'), false);
  assert.equal(nodesOf(tree).some(node => node.props['data-node-id'] === 'b'), false);
  assert.equal(flatten(tree).filter(node => node.type === 'path' && node.props['data-edge']).length, 0);
  assert.ok(text(tree).includes('缺少有效静态坐标'));
});

test('invalid or absent snapshots do not claim completion or crash', () => {
  const { render } = renderer();
  assert.ok(text(render({ board: null })).includes('投影不可用'));
  assert.ok(text(render({ board: { ...makeBoard(), version: 9 } })).includes('版本不受支持'));
  assert.ok(text(render({ board: { ...makeBoard(), layout: { nodes: [null] } } })).includes('版本不受支持'));
  const board = makeBoard();
  board.events = [null]; board.unmatched = [null]; board.diagnostics = [null]; board.topology.edges = [null]; board.layout.groups = [null];
  board.run.status = 'unexpected';
  board.statusByNode.a = { status: 'unexpected' };
  const tree = render({ board });
  assert.ok(nodesOf(tree)[0].props['aria-label'].includes('未知'));
});

test('English locale translates UI controls and status without changing the data', () => {
  const { render } = renderer(), board = makeBoard();
  board.sourceStatus = 'unverified';
  const tree = render({ board, locale: 'en-US' });
  assert.ok(text(tree).includes('Workflow'));
  assert.ok(text(tree).includes('Source not verified'));
  assert.ok(text(tree).includes('Unknown'));
  assert.ok(flatten(tree).some(node => node.type === 'select' && node.props['aria-label'] === 'Filter by status'));
  assert.ok(nodesOf(tree)[0].props['aria-label'].includes('Unknown'));
  assert.ok(!text(tree).includes('来源未验证'));
});

test('styles use official theme colors without literals or global DOM effects', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  const tree = renderer().render({ board: makeBoard() });
  const css = text(flatten(tree).find(node => node.type === 'style'));
  assert.match(css, /var\(--dsw-alias-/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsl/);
  assert.doesNotMatch(source, /document\.(?:body|head)|addEventListener\s*\(|setInterval\s*\(/);
});

test('empty inputs show honest empty state and interactive SVG is keyboard accessible', () => {
  const r = renderer(), board = makeBoard();
  const props = { board, sessions: sampleData(), statuses: new Map(), openSession() {} };
  let tree = r.render(props);
  const node = nodesOf(tree)[0];
  assert.equal(node.props.tabIndex, 0);
  assert.equal(typeof node.props['aria-label'], 'string');
  let prevented = false;
  node.props.onKeyDown({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  tree = r.render(props);
  assert.equal(rowsOf(tree)[0].props['data-selected'], true);
  const empty = r.render({ ...props, board: { ...board, topology: { ...board.topology, nodes: [], edges: [], groups: [] }, layout: { version: 1, nodes: [], groups: [] } } });
  assert.ok(text(empty).includes('暂无静态节点'));
  assert.ok(text(empty).includes('暂无事件'));
});

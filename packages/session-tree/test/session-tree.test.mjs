import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

// Test the actual shipped browser artifact through the same ModuleLoader seam.
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
let plugin;
let states = [], stateIndex = 0;
const React = {
  Fragment: Symbol('fragment'),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState(initial) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  },
  useRef() {
    const index = stateIndex++;
    if (!(index in states)) states[index] = { current: null };
    return states[index];
  }
};
const previousWindow = globalThis.window;
globalThis.window = { __ModuleLoader__: { load: spec => {
  assert.equal(spec.id, 'dsh-session-tree');
  plugin = spec.factory(id => { assert.equal(id, 'react'); return React; });
} } };
try { vm.runInThisContext(source); } finally { globalThis.window = previousWindow; }
const core = plugin.__test;

const summary = (id, extra = {}) => ({ id, title: id, running: false, blank: false, retainedBy: {}, ...extra });
const ready = entries => ({ state: 'ready', error: null, values: { subagentCatalog: entries } });
const child = (id, mode = 'continuable', label = id) => ({ id, mode, label });
const baseList = () => ({ phase: 'ready', ids: ['root'], byId: { root: summary('root') }, projectionsBySession: {} });

test('registers the rc.5 independent main slot and matching sidebar entry', () => {
  const registrations = [];
  const ctx = { slots: {
    inject(name, callback) { callback(); },
    register(options, component) { registrations.push({ options, component }); }
  }, sessions: {}, uiWorkspace: {}, sidebarRight: {} };
  plugin.apply(ctx);
  assert.deepEqual(registrations.map(({ options }) => [options.name, options.key ?? options.id]), [
    ['main', 'dsh-session-tree'], ['sidebar.panellist', 'dsh-session-tree']
  ]);
  assert.equal(typeof registrations[0].component, 'function');
  assert.equal(typeof registrations[1].component, 'function');
  assert.ok(plugin.inject.includes('sessions') && plugin.inject.includes('uiWorkspace'));
});

test('lazy expansion fetches only the clicked layer and builds arbitrary depth with real parents', async () => {
  const list = baseList();
  list.byId.a = summary('a', { origin: 'subagent', parentId: 'root' });
  list.byId.b = summary('b', { origin: 'subagent', parentId: 'a' });
  list.byId.c = summary('c', { origin: 'subagent', parentId: 'b' });
  const calls = [], data = { root: [child('a')], a: [child('b', 'one-shot')], b: [child('c', 'unknown')], c: [] };
  const expanded = new Set();
  const refresh = async id => { calls.push(id); list.projectionsBySession[id] = ready(data[id]); };
  const toggle = id => core.toggleBranch(id, expanded, refresh, list.projectionsBySession);
  assert.deepEqual(core.buildRows(list, expanded, new Set(), new Map()).map(r => r.id), ['root']);
  await toggle('root'); assert.deepEqual(calls, ['root']);
  assert.deepEqual(core.buildRows(list, expanded, new Set(), new Map()).map(r => [r.id, r.parentId, r.level]), [['root', null, 1], ['a', 'root', 2]]);
  await toggle('a'); await toggle('b');
  const rows = core.buildRows(list, expanded, new Set(), new Map());
  assert.deepEqual(rows.map(r => [r.id, r.parentId, r.level]), [['root', null, 1], ['a', 'root', 2], ['b', 'a', 3], ['c', 'b', 4]]);
  assert.deepEqual(calls, ['root', 'a', 'b']);
  assert.deepEqual(core.navigationTarget(rows[3]), { parentSessionId: 'b', childSessionId: 'c', mode: 'unknown' });
  assert.deepEqual(core.navigationTarget(rows[2]), { parentSessionId: 'a', childSessionId: 'b', mode: 'one-shot' });
  assert.equal(core.navigationTarget(rows[0]), 'root');
  await toggle('a');
  assert.deepEqual([...expanded], ['root']);
  assert.deepEqual(core.buildRows(list, expanded, new Set(), new Map()).map(r => r.id), ['root', 'a']);
});

test('migration and external rows cannot expand; external cannot be navigated', () => {
  const list = baseList();
  list.byId.migrate = summary('migrate', { origin: 'subagent', formatStatus: 'migration-required' });
  list.projectionsBySession.root = ready([child('migrate'), child('ext', 'external')]);
  const rows = core.buildRows(list, new Set(['root']), new Set(), new Map());
  assert.equal(rows[1].expandable, false);
  assert.equal(rows[1].migrationRequired, true);
  assert.deepEqual(core.navigationTarget(rows[1]), { parentSessionId: 'root', childSessionId: 'migrate', mode: 'continuable' });
  assert.equal(rows[2].expandable, false);
  assert.equal(core.navigationTarget(rows[2]), null);
  list.byId.migrate.formatStatus = 'ok';
  list.projectionsBySession.migrate = { state: 'migration-required', values: {} };
  assert.equal(core.buildRows(list, new Set(['root']), new Set(), new Map())[1].migrationRequired, true);
});

test('authoritative empty catalog is a leaf, failure is visible and retryable', async () => {
  const list = baseList(), expanded = new Set(['root']);
  list.projectionsBySession.root = { state: 'error', error: { message: 'offline' }, values: {} };
  let [row] = core.buildRows(list, expanded, new Set(), new Map());
  assert.equal(row.catalogState, 'error'); assert.equal(row.error, 'offline'); assert.equal(row.expandable, true);
  assert.equal(core.catalogOf({ state: 'idle', values: {} }).state, 'unloaded');
  assert.equal(core.catalogOf({ state: 'idle', values: { subagentCatalog: [] } }).state, 'ready');
  assert.equal(core.catalogOf({ state: 'loading', values: {} }).state, 'loading');
  assert.equal(core.catalogOf({ state: 'ready', values: {} }).state, 'unavailable');
  assert.equal(core.catalogOf({ state: 'migration-required', values: { subagentCatalog: [child('old')] } }).state, 'migration-required');
  const calls = [];
  await core.retryBranch('root', async id => calls.push(id));
  assert.deepEqual(calls, ['root']);
  list.projectionsBySession.root = ready([]);
  [row] = core.buildRows(list, expanded, new Set(), new Map());
  assert.equal(row.expandable, false); assert.equal(row.catalogState, 'ready');
});

test('deleted roots disappear, archive and current status track provided snapshots', () => {
  const list = baseList();
  list.byId.a = summary('a', { origin: 'subagent', projectionValues: { subagentTiming: { lastTurnCompleted: true } } });
  list.projectionsBySession.root = ready([child('a')]);
  let rows = core.buildRows(list, new Set(['root']), new Set(['root']), new Map([['a', { running: true }]]));
  assert.equal(rows[0].archived, true);
  assert.equal(rows[0].status, 'archived');
  assert.equal(rows[1].status, 'running');
  rows = core.buildRows(list, new Set(['root']), new Set(), new Map([['a', { running: false }]]));
  assert.equal(rows[1].status, 'completed');
  delete list.byId.a.projectionValues;
  // Catalog-only fallback uses running=false as a placeholder, not an observation.
  assert.equal(core.buildRows(list, new Set(['root']), new Set(), new Map())[1].status, 'unknown');
  list.ids.push('a');
  assert.equal(core.buildRows(list, new Set(['root']), new Set(), new Map())[1].status, 'inactive');
  list.ids = []; delete list.byId.root;
  assert.deepEqual(core.buildRows(list, new Set(['root']), new Set(), new Map()), []);
});

test('avatar policy is deterministic, explicit and browser-local with safe fallback', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let prefs = core.readAvatarPrefs(storage);
  const overrides = { ...prefs, root: 'code', a: 'data' };
  assert.equal(core.saveAvatarPrefs(storage, overrides), true);
  prefs = core.readAvatarPrefs(storage);
  assert.equal(core.avatarType({ id: 'root', title: '调研项目' }, prefs), 'code');
  assert.equal(core.avatarType({ id: 'a', title: 'something else' }, prefs), 'data');
  assert.equal(core.avatarType({ id: 'x', title: '调研 B站' }, prefs), 'research');
  assert.equal(core.avatarType({ id: 'x', title: 'implement api' }, prefs), 'code');
  assert.equal(core.avatarType({ id: 'x', title: 'compose report' }, prefs), 'write');
  assert.equal(core.avatarType({ id: 'x', title: 'analyze data' }, prefs), 'data');
  assert.equal(core.avatarType({ id: 'x', title: 'test code' }, prefs), 'qa');
  assert.equal(core.avatarType({ id: 'x', title: 'unknown' }, prefs), 'lead');
  assert.equal(core.avatarType({ id: 'x', title: 'unknown', agentPreset: 'research' }, prefs), 'research');
  assert.equal(core.avatarType({ id: 'x', title: 'test', agentPreset: 'research', role: 'write' }, prefs), 'write');
  assert.equal(core.readAvatarPrefs({ getItem: () => '{bad' }).root, undefined);
  assert.equal(core.saveAvatarPrefs({ setItem() { throw new Error('blocked'); } }, {}), false);
  assert.equal(core.saveAvatarPrefs(undefined, {}), false);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAA=';
  assert.equal(core.validImage(png), true);
  assert.equal(core.validImage('data:image/svg+xml;base64,iVBORw0KGgoAAAA='), false);
  assert.equal(core.saveCustomImages(storage, { qa: png }), true);
  assert.deepEqual(core.readCustomImages(storage), { qa: png });
  assert.equal(core.saveCustomImages(undefined, {}), false);
});

test('component omits unavailable right-sidebar action on independent main panel', () => {
  states = []; stateIndex = 0;
  const list = baseList();
  list.projectionsBySession.root = ready([child('a')]);
  list.byId.a = summary('a', { origin: 'subagent', parentId: 'root' });
  let registration;
  plugin.apply({
    slots: { inject(_name, callback) { callback(); }, register(options, component) { if (options.name === 'main') registration = { options, component }; } },
    sessions: { refreshProjections() {}, refresh() {} }, uiWorkspace: { openSession() {} },
    sidebarRight: { openResource() { throw new Error('sidebarRight: no session surface is mounted'); } }
  });
  const actions = registration.options.inject();
  actions.expansion.add('root');
  const props = { ...actions, useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()), useWorkspaces: selector => selector({ archivedSessionIds: [] }) };
  function flatten(node) { return node && typeof node === 'object' ? [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)] : []; }
  const elements = flatten(registration.component(props));
  assert.ok(elements.some(node => node.props?.['data-session-id'] === 'a'));
  assert.equal(elements.some(node => /右侧栏打开/.test(node.props?.title ?? node.props?.['aria-label'] ?? '')), false);
  assert.equal('openAside' in actions, false);
  assert.equal(plugin.inject.includes('sidebarRight'), false);
});

test('component wires real DTO-shaped rows to keyboard and true navigation addresses', async () => {
  states = []; stateIndex = 0;
  const list = baseList(), expansion = new Set(['root', 'a']);
  list.byId.a = summary('a', { origin: 'subagent', parentId: 'root', title: 'Alpha', projectionValues: { subagentTiming: { lastTurnCompleted: true } } });
  list.byId.b = summary('b', { origin: 'subagent', parentId: 'a', title: 'Beta' });
  list.projectionsBySession = { root: ready([child('a')]), a: ready([child('b', 'one-shot')]) };
  const calls = [], registrations = [];
  const ctx = {
    slots: { inject(_name, callback) { callback(); }, register(options, component) { registrations.push({ options, component }); } },
    sessions: { refreshProjections: async id => calls.push(['refresh', id]), refresh: async () => {} },
    uiWorkspace: { openSession: target => { calls.push(['open', target]); return Promise.reject(new Error('open rejected')); } },
    sidebarRight: { openResource: (target, options) => calls.push(['aside', target, options]) }
  };
  plugin.apply(ctx);
  const registration = registrations.find(item => item.options.name === 'main');
  const actions = registration.options.inject();
  for (const id of expansion) actions.expansion.add(id);
  const elements = ['root', 'a', 'b'].map(id => ({ dataset: { sessionId: id }, focus() { calls.push(['focus', id]); } }));
  const props = { ...actions, useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()), useWorkspaces: selector => selector({ archivedSessionIds: [] }) };
  function render() { stateIndex = 0; return registration.component(props); }
  function flatten(node) { return node && typeof node === 'object' ? [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)] : []; }
  let tree = flatten(render());
  const findRow = id => tree.find(node => node.props?.['data-session-id'] === id);
  const root = findRow('root'), a = findRow('a'), b = findRow('b');
  assert.deepEqual([root.props.tabIndex, a.props.tabIndex, b.props.tabIndex], [0, -1, -1]);
  states[7].current = { querySelectorAll: () => elements }; // TreePanel's useRef
  const key = (row, code) => row.props.onKeyDown({ key: code, target: 1, currentTarget: 1, preventDefault() {} });
  key(root, 'ArrowRight'); assert.deepEqual(calls.at(-1), ['focus', 'a']);
  tree = flatten(render()); assert.equal(findRow('a').props.tabIndex, 0);
  key(findRow('b'), 'ArrowLeft'); assert.deepEqual(calls.at(-1), ['focus', 'a']);
  key(findRow('a'), 'ArrowLeft'); // expanded branch collapses first
  tree = flatten(render());
  key(findRow('a'), 'ArrowLeft'); assert.deepEqual(calls.at(-1), ['focus', 'root']);
  key(b, 'Enter');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.find(call => call[0] === 'open'), ['open', { parentSessionId: 'a', childSessionId: 'b', mode: 'one-shot' }]);
  tree = flatten(render());
  assert.ok(tree.some(node => node.props?.role === 'status' && node.children.some(text => String(text).includes('open rejected'))));
  assert.equal(calls.some(call => call[0] === 'aside'), false);
});

test('flat tree gives correct sibling counts across multiple roots and grandchildren', () => {
  states = []; stateIndex = 0;
  const list = baseList();
  list.ids = ['root', 'root2'];
  list.byId.root2 = summary('root2');
  // A malformed cycle must not count as an exposed sibling.
  list.projectionsBySession = { root: ready([child('a'), child('b')]), a: ready([child('root'), child('c'), child('d')]) };
  for (const id of ['a', 'b', 'c', 'd']) list.byId[id] = summary(id, { origin: 'subagent' });
  let registration;
  plugin.apply({ slots: { inject(_name, callback) { callback(); }, register(options, component) { if (options.name === 'main') registration = { options, component }; } }, sessions: {}, uiWorkspace: {} });
  const actions = registration.options.inject();
  actions.expansion.add('root'); actions.expansion.add('a');
  const props = { ...actions, useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()), useWorkspaces: selector => selector({ archivedSessionIds: [] }) };
  function flatten(node) { return node && typeof node === 'object' ? [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)] : []; }
  const rows = flatten(registration.component(props)).filter(node => node.props?.role === 'treeitem');
  assert.deepEqual(rows.map(row => [row.props['data-session-id'], row.props['aria-level'], row.props['aria-posinset'], row.props['aria-setsize']]), [
    ['root', 1, 1, 2], ['a', 2, 1, 2], ['c', 3, 1, 2], ['d', 3, 2, 2], ['b', 2, 2, 2], ['root2', 1, 2, 2]
  ]);
});

test('clicking disclosure restores row focus so keyboard navigation remains available', () => {
  states = []; stateIndex = 0;
  const list = baseList();
  list.projectionsBySession.root = ready([child('a')]);
  list.byId.a = summary('a', { origin: 'subagent', parentId: 'root' });
  const calls = [];
  let registration;
  plugin.apply({ slots: { inject(_name, callback) { callback(); }, register(options, component) { if (options.name === 'main') registration = { options, component }; } },
    sessions: { refreshProjections(id) { calls.push(['refresh', id]); }, refresh() {} }, uiWorkspace: {} });
  const actions = registration.options.inject();
  const props = { ...actions, useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()), useWorkspaces: selector => selector({ archivedSessionIds: [] }) };
  const elements = ['root', 'a'].map(id => ({ dataset: { sessionId: id }, focus() { calls.push(['focus', id]); } }));
  function render() { stateIndex = 0; return registration.component(props); }
  function flatten(node) { return node && typeof node === 'object' ? [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)] : []; }
  let rows = flatten(render()).filter(node => node.props?.role === 'treeitem');
  states[7].current = { querySelectorAll: () => elements };
  const disclosure = flatten(rows[0]).find(node => node.props?.className === 'caret');
  disclosure.props.onClick({ currentTarget: { closest: () => elements[0] } });
  assert.deepEqual(calls.at(-1), ['focus', 'root']);
  rows = flatten(render()).filter(node => node.props?.role === 'treeitem');
  rows[0].props.onKeyDown({ key: 'ArrowRight', target: elements[0], currentTarget: elements[0], preventDefault() {} });
  assert.deepEqual(calls.at(-1), ['focus', 'a']);
});

test('generated browser entry matches its source and six PNG assets', () => {
  execFileSync(process.execPath, [new URL('../build.mjs', import.meta.url).pathname, '--check']);
});

test('browser entry only needs React and host bundle is self-contained', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.equal(manifest.name, 'dsh-session-tree');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.match(patch, /name:\s*['"]?dsh-session-tree/);
  for (const entry of ['./index.js', './client.js', './cordis.patch.yml']) await readFile(new URL('../' + entry, import.meta.url));
});

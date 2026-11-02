import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Test the actual shipped browser artifact through the same ModuleLoader seam.
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
let plugin;
let states = [], stateIndex = 0, effects = [], pendingEffects = [], mountedForTest = true, postUnmountUpdates = 0;
const React = {
  Fragment: Symbol('fragment'),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState(initial) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], next => { if (!mountedForTest) postUnmountUpdates++; states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  },
  useRef(initial) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = { current: initial ?? null };
    return states[index];
  },
  useEffect(callback, deps) {
    const index = stateIndex++, previous = effects[index];
    if (!previous || !deps || deps.some((dep,i) => !Object.is(dep,previous.deps?.[i]))) pendingEffects.push({index,callback,deps});
  },
  useLayoutEffect(callback, deps) {
    const index = stateIndex++, previous = effects[index];
    if (!previous || !deps || deps.some((dep,i) => !Object.is(dep,previous.deps?.[i]))) pendingEffects.push({index,callback,deps,layout:true});
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

// Mirror rc.5's namespace registration, slot t injection and owning effects.
function mockLocale() {
  const namespaces = new Map();
  let language = 'zh';
  return {
    namespaces,
    setLanguage(value) { language = value; },
    register(ns, dicts) {
      assert.equal(namespaces.has(ns), false, 'a namespace must not be registered twice');
      namespaces.set(ns, dicts);
      return () => { if (namespaces.get(ns) === dicts) namespaces.delete(ns); };
    },
    bind(ns) {
      return (key, params = {}) => {
        const template = namespaces.get(ns)?.[language]?.[key] ?? key;
        return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
      };
    }
  };
}
function commitMockEffects() {
  for (const effect of pendingEffects) {
    effects[effect.index]?.cleanup?.();
    effects[effect.index]={deps:effect.deps,cleanup:effect.callback(),setup:effect.callback,layout:effect.layout};
  }
  pendingEffects=[];
}
function applyPlugin(ctx) {
  const effects = [];
  ctx.locale ??= mockLocale();
  ctx.effect = callback => { const dispose = callback(); if (typeof dispose === 'function') effects.push(dispose); };
  const register = ctx.slots.register;
  ctx.slots.register = function(options, component) {
    return register.call(this, options, props => component({ t: ctx.locale.bind(options.locale), ...props }));
  };
  plugin.apply(ctx);
  return () => { for (const dispose of effects.reverse()) dispose(); };
}

test('registers the rc.5 independent main slot and matching sidebar entry', () => {
  const registrations = [];
  const ctx = { slots: {
    inject(name, callback) { callback(); },
    register(options, component) { registrations.push({ options, component }); }
  }, sessions: {}, uiWorkspace: {}, sidebarRight: {} };
  applyPlugin(ctx);
  assert.deepEqual(registrations.map(({ options }) => [options.name, options.key ?? options.id]), [
    ['main', 'dsh-session-tree'], ['sidebar.panellist', 'dsh-session-tree']
  ]);
  assert.equal(typeof registrations[0].component, 'function');
  assert.equal(typeof registrations[1].component, 'function');
  assert.ok(plugin.inject.includes('sessions') && plugin.inject.includes('uiWorkspace'));
});

test('locale dictionary and slots are owned by the plugin lifecycle', () => {
  const registrations = [], locale = mockLocale();
  const ctx = { locale, slots: {
    inject(_name, callback) { callback(); },
    register(options, component) { registrations.push({ options, component }); }
  }, sessions: {}, uiWorkspace: {} };
  const dispose = applyPlugin(ctx);
  assert.ok(plugin.inject.includes('locale'));
  const main = registrations.find(item => item.options.name === 'main');
  const panel = registrations.find(item => item.options.name === 'sidebar.panellist');
  assert.ok(main.options.locale);
  assert.equal(panel.options.locale, main.options.locale);
  assert.deepEqual([...locale.namespaces.keys()], [main.options.locale]);
  const dictionaries = locale.namespaces.get(main.options.locale);
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh']);
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort());
  for (const key of Object.keys(dictionaries.en)) {
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(dictionaries.zh[key]), placeholders(dictionaries.en[key]), `placeholder mismatch: ${key}`);
  }
  locale.setLanguage('zh'); assert.equal(panel.options.label(), '会话树');
  locale.setLanguage('en'); assert.equal(panel.options.label(), 'Session tree');
  dispose();
  assert.equal(locale.namespaces.size, 0);
  const again = applyPlugin(ctx);
  assert.equal(locale.namespaces.size, 1);
  again();
  assert.equal(locale.namespaces.size, 0);
});

test('panel renders translated text, accessible controls, and errors in zh and en', () => {
  const registrations = [], locale = mockLocale();
  const list = baseList();
  list.projectionsBySession.root = { state: 'error', values: {} };
  applyPlugin({ locale, slots: {
    inject(_name, callback) { callback(); },
    register(options, component) { registrations.push({ options, component }); }
  }, sessions: { refreshProjections() {}, refresh() {} }, uiWorkspace: { openSession() {} } });
  const main = registrations.find(item => item.options.name === 'main');
  const actions = main.options.inject();
  actions.expansion.add('root');
  const props = { ...actions, useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()), useWorkspaces: selector => selector({ archivedSessionIds: [] }) };
  const flatten = node => node && typeof node === 'object' ? [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)] : [];
  function render(language) { locale.setLanguage(language); states = []; stateIndex = 0; return flatten(main.component(props)); }
  for (const [language, expected] of Object.entries({
    zh: { title: '会话树', label: '折叠 root', avatar: '更改 root 的头像', status: '未运行', error: '目录读取失败：读取目录失败', retry: '重试' },
    en: { title: 'Session tree', label: 'Collapse root', avatar: 'Change avatar for root', status: 'Inactive', error: 'Failed to load catalog: Failed to read catalog', retry: 'Retry' }
  })) {
    const elements = render(language), row = elements.find(node => node.props?.role === 'treeitem');
    assert.ok(elements.some(node => node.type === 'h1' && node.children.includes(expected.title)));
    assert.ok(row.props['aria-label'].includes(expected.status));
    assert.ok(elements.some(node => node.props?.['aria-label'] === expected.label));
    assert.ok(elements.some(node => node.props?.['aria-label'] === expected.avatar));
    assert.ok(elements.some(node => node.props?.role === 'alert' && node.children.includes(expected.error)));
    assert.ok(elements.some(node => node.type === 'button' && node.children.includes(expected.retry)));
    if (language === 'en') {
      const textAndLabels = elements.flatMap(node => [...node.children.filter(value => typeof value === 'string'), node.props?.['aria-label'], node.props?.title].filter(value => typeof value === 'string')).join(' ');
      assert.doesNotMatch(textAndLabels, /[\u3400-\u9fff]/);
    }
  }
});

test('changing locale retranslates an existing notice without resetting the tree', () => {
  const registrations = [], locale = mockLocale(), list = baseList();
  applyPlugin({ locale, slots: {
    inject(_name, callback) { callback(); },
    register(options, component) { registrations.push({ options, component }); }
  }, sessions: { refreshProjections() {}, refresh() {} }, uiWorkspace: { openSession() {} } });
  const main = registrations.find(item => item.options.name === 'main'), actions = main.options.inject();
  actions.expansion.add('root');
  const props = { ...actions, useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()), useWorkspaces: selector => selector({ archivedSessionIds: [] }) };
  const flatten = node => node && typeof node === 'object' ? [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)] : [];
  function render() {
    stateIndex = 0; pendingEffects = [];
    const nodes = flatten(main.component(props));
    for (const effect of pendingEffects) { effects[effect.index]?.cleanup?.(); effects[effect.index] = {deps:effect.deps,cleanup:effect.callback()}; }
    return nodes;
  }
  states = []; effects = []; locale.setLanguage('zh');
  const input = render().find(node => node.type === 'input' && node.props.type === 'file');
  input.props.onChange({ target: { files: [{ type: 'image/jpeg', size: 1 }], value: 'x' } });
  let elements = render();
  assert.ok(elements.some(node => node.props?.role === 'status' && node.children.includes('请选择不超过 180 KB 的 PNG 图片。')));
  locale.setLanguage('en');
  elements = render();
  assert.ok(elements.some(node => node.props?.role === 'status' && node.children.includes('Choose a PNG image no larger than 180 KB.')));
  assert.equal(elements.find(node => node.props?.['data-session-id'] === 'root').props['aria-expanded'], true);
});

test('CSS colors use only known rc.5 alias tokens without color fallbacks', async () => {
  const template = await readFile(new URL('../client.template.js', import.meta.url), 'utf8');
  const css = template.match(/const CSS = `([\s\S]*?)`;/)?.[1];
  assert.ok(css);
  const official = new Set(['bg-layer-1', 'label-primary', 'label-secondary', 'label-tertiary', 'border-l3', 'interactive-bg-hover', 'state-error-primary', 'state-business-primary', 'state-success-primary', 'state-warn-primary', 'state-idle-primary', 'brand-primary']);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\s*\(/i);
  assert.doesNotMatch(css, /var\(--dsw-alias-[\w-]+\s*,/);
  for (const match of css.matchAll(/var\(--dsw-alias-([\w-]+)/g)) assert.ok(official.has(match[1]), `unknown rc.5 alias: ${match[1]}`);
  for (const match of css.matchAll(/(?:^|[;{])\s*(?:color|background(?:-color)?|outline|border(?:-color)?)\s*:\s*([^;}]+)/g)) {
    const value = match[1];
    if (/^(?:0|none|transparent|inherit)$/.test(value)) continue;
    assert.match(value, /var\(--dsw-alias-[\w-]+\)/, `non-token color: ${value}`);
  }
});

test('lazy expansion fetches only the clicked layer and builds arbitrary depth with real parents', async () => {
  const list = baseList();
  list.byId.a = summary('a', { origin: 'subagent', parentId: 'root' });
  list.byId.b = summary('b', { origin: 'subagent', parentId: 'a' });
  list.byId.c = summary('c', { origin: 'subagent', parentId: 'b' });
  const calls = [], data = { root: [child('a')], a: [child('b', 'one-shot')], b: [child('c', 'unknown')], c: [] };
  const expanded = new Set();
  const refresh = async id => { calls.push(id); list.projectionsBySession[id] = ready(data[id]); };
  const toggle = id => {
    const rows = core.buildRows(list,expanded,new Set(),new Map());
    return core.toggleBranch(rows.find(row=>row.id===id),expanded,refresh,rows);
  };
  assert.deepEqual(core.buildRows(list, expanded, new Set(), new Map()).map(r => r.id), ['root']);
  await toggle('root'); assert.deepEqual(calls, ['root']);
  assert.deepEqual(core.buildRows(list, expanded, new Set(), new Map()).map(r => [r.id, r.parentId, r.level]), [['root', null, 1], ['a', 'root', 2]]);
  await toggle('a'); await toggle('b');
  const rows = core.buildRows(list, expanded, new Set(), new Map());
  assert.deepEqual(rows.map(r => [r.id, r.parentId, r.level]), [['root', null, 1], ['a', 'root', 2], ['b', 'a', 3], ['c', 'b', 4]]);
  assert.deepEqual(calls, ['root', 'a', 'b']);
  assert.equal(core.navigationTarget(rows[3]), null);
  assert.equal(rows[3].unknownMode, true);
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
  assert.equal(core.catalogOf({ state: 'idle', values: { subagentCatalog: [] } }).state, 'unloaded');
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

test('idle cached empty catalogs can expand, refresh and become authoritative', async () => {
  const list = baseList(), expanded = new Set(), calls = [];
  list.byId.a = summary('a', { origin: 'subagent', parentId: 'root' });
  list.projectionsBySession.root = { state: 'idle', error: null, values: { subagentCatalog: [] } };
  let [root] = core.buildRows(list, expanded, new Set(), new Map());
  assert.equal(root.expandable, true);
  await core.toggleBranch(root, expanded, async id => {
    calls.push(id);
    list.projectionsBySession[id] = ready([child('a')]);
  }, [root]);
  assert.deepEqual(calls, ['root']);
  assert.deepEqual(core.buildRows(list, expanded, new Set(), new Map()).map(row => [row.id, row.parentId]), [['root', null], ['a', 'root']]);
  list.projectionsBySession.a = { state: 'idle', error: null, values: { subagentCatalog: [] } };
  let a = core.buildRows(list, expanded, new Set(), new Map())[1];
  assert.equal(a.expandable, true);
  await core.toggleBranch(a, expanded, async id => {
    calls.push(id);
    list.projectionsBySession[id] = ready([]);
  }, core.buildRows(list,expanded,new Set(),new Map()));
  a = core.buildRows(list, expanded, new Set(), new Map())[1];
  assert.equal(a.expandable, false);
  assert.deepEqual(calls, ['root', 'a']);
});

test('disclosure UI refreshes an idle cached empty root without preloading', async () => {
  states = []; effects = []; pendingEffects = []; stateIndex = 0;
  const list = baseList(), calls = [];
  list.projectionsBySession.root = { state: 'idle', error: null, values: { subagentCatalog: [] } };
  let registration;
  applyPlugin({
    slots: { inject(_name, callback) { callback(); }, register(options, component) { if (options.name === 'main') registration = { options, component }; } },
    sessions: { refreshProjections: async id => { calls.push(id); list.projectionsBySession[id] = ready([child('a')]); }, refresh() {} },
    uiWorkspace: { openSession() {} }
  });
  const props = { ...registration.options.inject(), useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()), useWorkspaces: selector => selector({ archivedSessionIds: [] }) };
  function render() { stateIndex = 0; pendingEffects=[]; const node=registration.component(props);commitMockEffects();return node; }
  function flatten(node) { return node && typeof node === 'object' ? [node, ...(node.children ?? []).flat(Infinity).flatMap(flatten)] : []; }
  let elements = flatten(render());
  const root = elements.find(node => node.props?.['data-session-id'] === 'root');
  const disclosure = flatten(root).find(node => node.props?.className === 'caret');
  assert.deepEqual(calls, []);
  assert.equal(disclosure.props.disabled, false);
  disclosure.props.onClick({ currentTarget: { closest: () => ({ focus() {} }) } });
  await new Promise(resolve => setImmediate(resolve));
  elements = flatten(render());
  assert.deepEqual(calls, ['root']);
  assert.ok(elements.some(node => node.props?.['data-session-id'] === 'a'));
});

function refreshHarness({refresh, strict=false}={}) {
  states=[];effects=[];pendingEffects=[];stateIndex=0;mountedForTest=true;postUnmountUpdates=0;
  let registration;
  applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},sessions:{refreshProjections:refresh,refresh(){}},uiWorkspace:{openSession(){}}});
  const list=baseList(),actions=registration.options.inject();
  list.projectionsBySession.root={state:'loading',values:{subagentCatalog:[child('a')]}};
  list.projectionsBySession.a={state:'loading',values:{subagentCatalog:[]}};
  const props={...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
  const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
  function render(){
    stateIndex=0;pendingEffects=[];const nodes=flatten(registration.component(props));
    for(const effect of pendingEffects){const first=!effects[effect.index];effects[effect.index]?.cleanup?.();let cleanup=effect.callback();if(strict&&first){cleanup?.();cleanup=effect.callback();}effects[effect.index]={deps:effect.deps,cleanup,setup:effect.callback,layout:effect.layout};}
    return nodes;
  }
  function caret(id){const nodes=render(),row=nodes.find(node=>node.props?.['data-session-id']===id);assert.ok(row,`missing ${id}`);flatten(row).find(node=>node.props?.className==='caret').props.onClick({currentTarget:{closest(){}}});}
  function retry(){const button=render().find(node=>node.type==='button'&&node.children.includes('重试'));assert.ok(button);button.props.onClick();}
  function alert(){return render().filter(node=>node.props?.role==='alert').flatMap(node=>node.children).filter(text=>typeof text==='string').join(' ');}
  function layoutUnmount(){for(const effect of effects)if(effect?.layout)effect.cleanup?.();mountedForTest=false;}
  function dispose(){for(const effect of effects)effect?.cleanup?.();mountedForTest=true;}
  return {list,actions,render,caret,retry,alert,layoutUnmount,dispose,updatesAfterUnmount:()=>postUnmountUpdates};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const flushRefresh=()=>new Promise(resolve=>setImmediate(resolve));

test('refresh callbacks run after expansion state is committed, before reentrant actions', async () => {
  const pending=[];let app,first=true;
  app=refreshHarness({refresh:id=>{
    const request=deferred();pending.push({id,...request});
    if(first){first=false;app.caret('root');app.caret('root');}
    return request.promise;
  }});
  try {
    app.caret('root');await flushRefresh();
    assert.equal(pending.length,2);
    pending[1].resolve();await flushRefresh();pending[0].reject(Error('superseded'));await flushRefresh();
    assert.doesNotMatch(app.alert(),/superseded/);
    assert.equal(app.actions.expansion.has('root'),true);
  } finally {app.dispose();}
});

test('synchronous adapter reentrancy cannot make an older refresh the latest intent', async () => {
  const requests=[];let app,first=true;
  app=refreshHarness({refresh:()=>{
    const request=deferred();requests.push(request);
    if(first){first=false;app.retry();}
    return request.promise;
  }});
  try {
    app.actions.expansion.add('root');
    app.retry();await flushRefresh();assert.equal(requests.length,2);
    requests[1].resolve();await flushRefresh();requests[0].reject(Error('older reentrant request'));await flushRefresh();
    assert.doesNotMatch(app.alert(),/older reentrant request/);
  } finally {app.dispose();}
});

test('refresh completion from closed or superseded expansion cannot override latest', async () => {
  const pending=[];const app=refreshHarness({refresh:id=>{const request=deferred();pending.push({id,...request});return request.promise;}});
  try {
    app.caret('root');await flushRefresh();app.caret('root');app.caret('root');await flushRefresh();
    assert.equal(pending.length,2);
    pending[1].resolve();await flushRefresh();pending[0].reject(Error('old failure'));await flushRefresh();
    assert.equal(app.alert(),'');
    app.retry();await flushRefresh();app.retry();await flushRefresh();
    pending[3].reject(Error('new failure'));await flushRefresh();pending[2].resolve();await flushRefresh();
    assert.match(app.alert(),/new failure/);
    app.caret('root');app.caret('root');await flushRefresh();assert.equal(app.alert(),'');
  } finally {app.dispose();}
});

test('closing a parent invalidates pending visible descendants but not another root', async () => {
  const pending=[];const app=refreshHarness({refresh:id=>{const request=deferred();pending.push({id,...request});return request.promise;}});
  try {
    app.list.ids.push('other');app.list.byId.other=summary('other');app.list.projectionsBySession.other={state:'loading',values:{subagentCatalog:[]}};
    app.caret('root');await flushRefresh();app.caret('a');await flushRefresh();app.caret('other');await flushRefresh();app.caret('root');
    pending.find(item=>item.id==='a').reject(Error('hidden failure'));pending.find(item=>item.id==='other').reject(Error('other failure'));await flushRefresh();
    assert.match(app.alert(),/other failure/);app.caret('root');await flushRefresh();
    assert.doesNotMatch(app.alert(),/hidden failure/);
  } finally {app.dispose();}
});

test('closing invalidates pending descendants even while their rows become non-expandable', async () => {
  const pending=[];const app=refreshHarness({refresh:id=>{const request=deferred();pending.push({id,...request});return request.promise;}});
  try {
    app.caret('root');await flushRefresh();app.caret('a');await flushRefresh();
    app.list.projectionsBySession.a=ready([]);
    app.caret('root');
    app.list.projectionsBySession.a={state:'loading',values:{subagentCatalog:[]}};
    app.caret('root');
    // A was blocked at close and remains expanded; reopening must not revive its old request.
    pending.find(item=>item.id==='a').reject(Error('old blocked descendant'));await flushRefresh();
    assert.doesNotMatch(app.alert(),/old blocked descendant/);
  } finally {app.dispose();}
});

test('ambiguous descendant and independent root retain their shared host request on parent close', async () => {
  const shared=deferred();const app=refreshHarness({refresh:()=>shared.promise});
  try {
    app.list.ids.push('other');app.list.byId.other=summary('other');
    app.list.projectionsBySession.a={state:'loading',values:{subagentCatalog:[child('nested')]}};
    app.list.projectionsBySession.nested={state:'loading',values:{subagentCatalog:[]}};
    app.list.projectionsBySession.other={state:'loading',values:{subagentCatalog:[]}};
    app.caret('root');await flushRefresh();app.caret('a');await flushRefresh();app.caret('nested');await flushRefresh();app.caret('other');await flushRefresh();
    app.list.projectionsBySession.other={state:'loading',values:{subagentCatalog:[child('nested')]}};
    let nodes=app.render(), nested=nodes.find(node=>node.props?.['data-session-id']==='nested');
    assert.equal(nested.props['aria-disabled'],true);
    app.caret('root');
    assert.equal(app.actions.expansion.has('nested'),true);
    assert.equal(app.actions.expansion.has('other'),true);
    shared.reject(Error('still active shared request'));await flushRefresh();
    assert.match(app.alert(),/still active shared request/);
    app.list.projectionsBySession.other={state:'loading',values:{subagentCatalog:[]}};
    app.caret('root');nodes=app.render();
    assert.ok(nodes.some(node=>node.props?.role==='alert'&&node.children.some(text=>typeof text==='string'&&text.includes('still active shared request'))));
  } finally {app.dispose();}
});

test('a closed descendant request cannot reappear as an error when ancestor reopens', async () => {
  const pending=[];const app=refreshHarness({refresh:id=>{const request=deferred();pending.push({id,...request});return request.promise;}});
  try {
    app.caret('root');await flushRefresh();app.caret('a');await flushRefresh();app.caret('root');app.caret('root');await flushRefresh();app.caret('a');await flushRefresh();
    const requests=pending.filter(item=>item.id==='a');assert.equal(requests.length,2);
    requests[1].resolve();await flushRefresh();requests[0].reject(Error('old descendant failure'));await flushRefresh();
    assert.doesNotMatch(app.alert(),/old descendant failure/);
  } finally {app.dispose();}
});

test('shared refresh promises only affect the latest intent and latest failure remains visible', async () => {
  const shared=deferred();const app=refreshHarness({refresh:()=>shared.promise});
  try {
    app.caret('root');await flushRefresh();app.caret('root');app.caret('root');await flushRefresh();app.retry();await flushRefresh();
    shared.reject(Error('shared failure'));await flushRefresh();
    assert.match(app.alert(),/shared failure/);
  } finally {app.dispose();}
});

test('StrictMode layout effect replay fences pre-replay refresh completion', async () => {
  const pending=[];const app=refreshHarness({refresh:()=>{const request=deferred();pending.push(request);return request.promise;}});
  try {
    app.caret('root');await flushRefresh();
    const effect=effects.find(item=>item?.layout);assert.ok(effect);
    effect.cleanup();effect.cleanup=effect.setup();
    pending[0].reject(Error('previous generation'));await flushRefresh();
    assert.doesNotMatch(app.alert(),/previous generation/);
    app.retry();await flushRefresh();pending[1].reject(Error('current generation'));await flushRefresh();
    assert.match(app.alert(),/current generation/);
  } finally {app.dispose();}
});

test('refresh rejection with a throwing message accessor has no unhandled promise', async () => {
  const unhandled=[];const listener=reason=>unhandled.push(reason);process.on('unhandledRejection',listener);
  const bad=Object.defineProperty({},'message',{get(){throw Error('bad message');}});
  const app=refreshHarness({refresh:()=>Promise.reject(bad)});
  try {app.caret('root');await flushRefresh();await flushRefresh();assert.deepEqual(unhandled,[]);}
  finally {app.dispose();process.off('unhandledRejection',listener);}
});

test('refresh intent skips superseded not-yet-dispatched host work', async () => {
  const calls=[];const app=refreshHarness({refresh:id=>{calls.push(id);return Promise.resolve();}});
  try {
    app.caret('root');app.caret('root');await flushRefresh();
    assert.deepEqual(calls,[]);
    app.caret('root');await flushRefresh();assert.deepEqual(calls,['root']);
  } finally {app.dispose();}
});

test('refresh synchronous throw is displayed while mounted, never after layout unmount', async () => {
  for(const strict of [false,true]) {
    const pending=deferred();let calls=0;
    const app=refreshHarness({strict,refresh:()=>{calls++;if(calls===1)throw Error('sync error');return pending.promise;}});
    try {
      app.caret('root');await flushRefresh();assert.match(app.alert(),/sync error/);
      app.retry();await flushRefresh();app.layoutUnmount();pending.reject(Error('after unmount'));await flushRefresh();
      assert.equal(app.updatesAfterUnmount(),0);
    } finally {app.dispose();}
  }
});

test('nonempty cached catalog remains visible on expansion and migration remains closed', () => {
  const list = baseList();
  list.projectionsBySession.root = { state: 'idle', error: null, values: { subagentCatalog: [child('a')] } };
  let rows = core.buildRows(list, new Set(['root']), new Set(), new Map());
  assert.deepEqual(rows.map(row => row.id), ['root', 'a']);
  assert.equal(rows[0].expandable, true);
  list.projectionsBySession.root = { state: 'migration-required', error: null, values: { subagentCatalog: [child('a')] } };
  rows = core.buildRows(list, new Set(['root']), new Set(), new Map());
  assert.deepEqual(rows.map(row => row.id), ['root']);
  assert.equal(rows[0].migrationRequired, true);
  assert.equal(rows[0].expandable, false);
});

test('idle nonempty cache retains entries but reports refresh errors or absent projection', async () => {
  const list = baseList(), expanded = new Set();
  list.projectionsBySession.root = { state: 'idle', error: null, values: { subagentCatalog: [child('a')] } };
  let [row] = core.buildRows(list, expanded, new Set(), new Map());
  assert.equal(row.expandable, true);
  await core.toggleBranch(row, expanded, async id => {
    list.projectionsBySession[id] = { state: 'error', error: { message: 'offline' }, values: { subagentCatalog: [child('a')] } };
  }, [row]);
  let rows = core.buildRows(list, expanded, new Set(), new Map());
  assert.equal(rows[0].catalogState, 'error');
  assert.equal(rows[0].error, 'offline');
  assert.deepEqual(rows.map(item => item.id), ['root', 'a']);
  await core.retryBranch('root', async id => { list.projectionsBySession[id] = { state: 'ready', error: null, values: {} }; });
  [row] = core.buildRows(list, expanded, new Set(), new Map());
  assert.equal(row.catalogState, 'unavailable');
  assert.equal(row.expandable, true);
  list.projectionsBySession.root = { state: 'migration-required', error: null, values: { subagentCatalog: [] } };
  [row] = core.buildRows(list, expanded, new Set(), new Map());
  assert.equal(row.migrationRequired, true);
  assert.equal(row.expandable, false);
  assert.equal(row.expanded, false);
});

test('unknown catalog states keep conservative conflict evidence but do not show untrusted children', () => {
  for (const state of [undefined,null,'pending',42,{}]) {
    for (const entries of [[],[child('cached')],undefined]) {
      const list=baseList();list.projectionsBySession.root={state,values:entries===undefined?{}:{subagentCatalog:entries}};
      const rows=core.buildRows(list,new Set(['root']),new Set(),new Map());
      assert.equal(rows[0].catalogState,'unknown',String(state));
      assert.equal(rows[0].expandable,true,String(state));
      assert.deepEqual(rows.map(row=>row.id),['root']);
    }
  }
  const list=baseList();list.projectionsBySession.root={state:'idle',values:{subagentCatalog:[child('cached')]}};
  assert.deepEqual(core.buildRows(list,new Set(['root']),new Set(),new Map()).map(row=>row.id),['root','cached']);
});

test('unknown catalog state warns in both languages, hides children and permits retry', async () => {
  for (const language of ['zh','en']) {
    states=[];effects=[];pendingEffects=[];stateIndex=0;const locale=mockLocale();locale.setLanguage(language);let registration,calls=0;
    applyPlugin({locale,slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},sessions:{refreshProjections(){calls++;},refresh(){}},uiWorkspace:{openSession(){}}});
    const list=baseList();list.projectionsBySession.root={state:'alien',values:{subagentCatalog:[child('cached')]}};
    const actions=registration.options.inject();actions.expansion.add('root');
    const props={...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
    const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
    const render=()=>{stateIndex=0;pendingEffects=[];const nodes=flatten(registration.component(props));commitMockEffects();return nodes;};
    let nodes=render();
    assert.equal(nodes.some(node=>node.props?.['data-session-id']==='cached'),false);
    const warning=nodes.find(node=>node.props?.role==='status'&&node.children.some(text=>typeof text==='string'&&text.includes(language==='zh'?'目录状态未知':'Catalog status unknown')));
    assert.ok(warning,language);
    flatten(warning).find(node=>node.type==='button').props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,1);
    list.projectionsBySession.root=ready([child('cached')]);
    nodes=render();
    assert.ok(nodes.some(node=>node.props?.['data-session-id']==='cached'));
    assert.equal(nodes.some(node=>node.props?.role==='status'&&node.children.some(text=>typeof text==='string'&&text.includes(language==='zh'?'目录状态未知':'Catalog status unknown'))),false);
  }
});

test('unknown catalog cache participates in conflict detection without exposing its children', () => {
  const list=baseList();list.ids.push('other');list.byId.other=summary('other');
  list.projectionsBySession={root:{state:'future',values:{subagentCatalog:[child('shared')]}},other:ready([child('shared')])};
  const rows=core.buildRows(list,new Set(['root','other']),new Set(),new Map());
  assert.deepEqual(rows.map(row=>row.id),['root','other','shared']);
  const shared=rows.find(row=>row.id==='shared');
  assert.equal(shared.ambiguous,true);assert.equal(core.navigationTarget(shared),null);assert.equal(shared.expandable,false);
  list.projectionsBySession.root=ready([]);
  const refreshed=core.buildRows(list,new Set(['root','other']),new Set(),new Map());
  const unique=refreshed.find(row=>row.id==='shared');
  assert.equal(unique.ambiguous,false);assert.notEqual(core.navigationTarget(unique),null);
});

test('known loading and error catalog cache remains visible', () => {
  for (const state of ['loading','error']) {
    const list=baseList();list.projectionsBySession.root={state,error:{message:'offline'},values:{subagentCatalog:[child('cached')]}};
    const rows=core.buildRows(list,new Set(['root']),new Set(),new Map());
    assert.deepEqual(rows.map(row=>row.id),['root','cached']);
    assert.equal(rows[0].catalogState,state);
  }
});

test('malformed summary titles and entry labels fall back to safe strings', () => {
  const malformed=[null,undefined,17,{value:'not text'},['x'],true];
  for(const value of malformed) {
    const list=baseList();list.byId.root.title=value;list.byId.root.displayTitle=value;
    list.projectionsBySession.root=ready([child('sub','continuable',value)]);
    const rows=core.buildRows(list,new Set(['root']),new Set(),new Map());
    assert.deepEqual(rows.map(row=>row.title),['root','sub']);
  }
  const list=baseList();list.byId.root.title=123;list.byId.root.displayTitle='  display title  ';
  list.projectionsBySession.root=ready([child('sub','continuable','  child label  ')]);
  const rows=core.buildRows(list,new Set(['root']),new Set(),new Map());
  assert.deepEqual(rows.map(row=>row.title),['  display title  ','child label']);
  states=[];stateIndex=0;let registration;
  applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},sessions:{refreshProjections(){},refresh(){}},uiWorkspace:{openSession(){}}});
  list.byId.root.title={unexpected:true};list.byId.root.displayTitle={unexpected:true};
  list.projectionsBySession.root=ready([child('sub','continuable',{unexpected:true})]);
  const actions=registration.options.inject();actions.expansion.add('root');
  const props={...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
  const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
  const rendered=flatten(registration.component(props)).filter(node=>node.props?.role==='treeitem');
  assert.ok(rendered.find(row=>row.props['data-session-id']==='root').props['aria-label'].startsWith('root'));
  assert.ok(rendered.find(row=>row.props['data-session-id']==='sub').props['aria-label'].startsWith('sub'));
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

const avatarBytesA=await readFile(new URL('../avatars/lead.png',import.meta.url));
const avatarBytesB=await readFile(new URL('../avatars/code.png',import.meta.url));
const avatarBytesC=await readFile(new URL('../avatars/data.png',import.meta.url));
const pngA='data:image/png;base64,'+avatarBytesA.toString('base64');
const pngB='data:image/png;base64,'+avatarBytesB.toString('base64');
const pngC='data:image/png;base64,'+avatarBytesC.toString('base64');
function pngChunk(type,data=Buffer.alloc(0)) {
  const length=Buffer.alloc(4);length.writeUInt32BE(data.length);
  return Buffer.concat([length,Buffer.from(type,'ascii'),data,Buffer.alloc(4)]);
}
function pngUrl(buffer){return 'data:image/png;base64,'+buffer.toString('base64');}
function insertBeforeIend(bytes,chunk){return Buffer.concat([bytes.subarray(0,-12),chunk,bytes.subarray(-12)]);}
function sizedPng(size) {
  const overhead=avatarBytesA.length+12;
  assert.ok(size>=overhead);
  return insertBeforeIend(avatarBytesA,pngChunk('tEXt',Buffer.alloc(size-overhead)));
}

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
  const png = pngA;
  assert.equal(core.validImage(png), true);
  assert.equal(core.validImage('data:image/svg+xml;base64,iVBORw0KGgoAAAA='), false);
  assert.equal(core.saveCustomImages(storage, { qa: png }), true);
  assert.deepEqual(core.readCustomImages(storage), { qa: png });
  assert.equal(core.saveCustomImages(undefined, {}), false);
});

test('bounded static PNG precheck rejects malformed chunks, animation, metadata and excess dimensions', () => {
  assert.equal(core.validImage(pngA),true);
  const invalid=[Buffer.from('89504e470d0a1a0a','hex'),avatarBytesA.subarray(0,23),avatarBytesA.subarray(0,-12),Buffer.concat([avatarBytesA,Buffer.from([0])])];
  const corruptFirst=Buffer.from(avatarBytesA);corruptFirst.writeUInt32BE(12,8);invalid.push(corruptFirst);
  const tooLong=Buffer.from(avatarBytesA);tooLong.writeUInt32BE(0xffffffff,8);invalid.push(tooLong);
  const nonzeroIend=Buffer.concat([avatarBytesA.subarray(0,-12),pngChunk('IEND',Buffer.from([0]))]);invalid.push(nonzeroIend);
  const noCrc=avatarBytesA.subarray(0,-1);invalid.push(noCrc);
  for(const tag of ['acTL','fcTL','fdAT','iCCP','zTXt','iTXt'])invalid.push(insertBeforeIend(avatarBytesA,pngChunk(tag)));
  invalid.push(Buffer.concat([avatarBytesA.subarray(0,-12),Buffer.from([0xff,0xff,0xff,0xff]),Buffer.from('tEXt'),Buffer.alloc(4),avatarBytesA.subarray(-12)]));
  for(const bytes of invalid)assert.equal(core.validImage(pngUrl(bytes)),false,`accepted malformed ${bytes.length}`);
  for(const [w,h,allowed] of [[0,1,false],[1,0,false],[2048,2048,true],[2049,1,false],[1,2049,false]]) {
    const bytes=Buffer.from(avatarBytesA);bytes.writeUInt32BE(w,16);bytes.writeUInt32BE(h,20);
    assert.equal(core.validImage(pngUrl(bytes)),allowed,`${w}x${h}`);
  }
  assert.equal(core.validImage(pngUrl(insertBeforeIend(avatarBytesA,pngChunk('tEXt',Buffer.from('acTL fcTL fdAT iCCP zTXt iTXt'))))),true);
  assert.equal(core.validImage(pngUrl(insertBeforeIend(avatarBytesA,pngChunk('IDAT')))),true);
  assert.equal(core.validImage(pngUrl(sizedPng(180000))),true);
  assert.equal(core.validImage(pngUrl(sizedPng(180001))),false);
  assert.equal(core.validImage('data:image/png;base64,iVBORw0KGgo='),false);
  assert.equal(core.validImage(pngA+'='),false);
  const oldAtob=globalThis.atob;try{globalThis.atob=undefined;assert.equal(core.validImage(pngA),false);globalThis.atob=()=>{throw Error('invalid')};assert.equal(core.validImage(pngA),false);}finally{globalThis.atob=oldAtob;}
});

test('duplicate IHDR chunks cannot bypass the unique dimension precheck', () => {
  const other=Buffer.from(avatarBytesA.subarray(16,29));other.writeUInt32BE(4096,0);other.writeUInt32BE(4096,4);
  const duplicate=pngChunk('IHDR',other);
  for(const data of [other,avatarBytesA.subarray(16,29)]) {
    const second=pngChunk('IHDR',data);
    for(const bytes of [Buffer.concat([avatarBytesA.subarray(0,33),second,avatarBytesA.subarray(33)]),insertBeforeIend(avatarBytesA,second)]) {
      assert.equal(core.validImage(pngUrl(bytes)),false,'duplicate IHDR rejected');
    }
  }
  assert.equal(core.validImage(pngUrl(insertBeforeIend(avatarBytesA,pngChunk('tEXt',Buffer.from('IHDR'))))),true);
  assert.equal(duplicate.length,25);
});

test('prototype-named session IDs do not inherit avatar preferences or stored errors', () => {
  for (const id of ['__proto__','constructor','toString']) {
    assert.equal(core.avatarType({id,title:'普通会话'},{}),'lead',id);
    const list={phase:'ready',ids:[id],byId:{[id]:summary(id)},projectionsBySession:{}};
    const rows=core.buildRows(list,new Set(),new Set(),new Map());
    assert.equal(rows.length,1);
    assert.equal(rows[0].catalogState,'unloaded');
  }
  const loaded=core.readAvatarPrefs({getItem:()=>'{"__proto__":"code","constructor":"data","toString":"qa"}'});
  assert.equal(core.avatarType({id:'__proto__'},loaded),'code');
  assert.equal(core.avatarType({id:'constructor'},loaded),'data');
  assert.equal(core.avatarType({id:'toString'},loaded),'qa');
});

test('inherited session-index entries do not create roots or cached descendants', () => {
  const foreign='test-inherited-session-id';
  const forged=summary(foreign);
  const inheritedById=Object.create({[foreign]:forged});
  assert.deepEqual(core.buildRows({ids:[foreign],byId:inheritedById,projectionsBySession:{}},new Set(),new Set(),new Map()),[]);
  const inheritedCatalog=Object.create({root:ready([child(foreign)])});
  const rows=core.buildRows({ids:['root'],byId:{root:summary('root')},projectionsBySession:inheritedCatalog},new Set(['root']),new Set(),new Map());
  assert.deepEqual(rows.map(row=>row.id),['root']);
  assert.equal(rows[0].catalogState,'unloaded');
  const pollutedPrefs=Object.create({[foreign]:'code'});
  assert.equal(core.avatarType({id:foreign,title:'normal'},pollutedPrefs),'lead');
});

test('session dictionary own getters remain readable for adapter compatibility', () => {
  let calls=0;
  const accessor=Object.defineProperty({},'root',{get(){calls++;return summary('root');},configurable:true});
  const projections=Object.defineProperty({},'root',{get(){calls++;return ready([child('leaf')]);},configurable:true});
  const rows=core.buildRows({ids:['root'],byId:accessor,projectionsBySession:projections},new Set(['root']),new Set(),new Map());
  assert.deepEqual(rows.map(row=>row.id),['root','leaf']);
  const prefs=Object.defineProperty({},'root',{get(){calls++;return 'code';},configurable:true});
  assert.equal(core.avatarType({id:'root',title:'normal'},prefs),'code');
  assert.ok(calls>0);
});

test('Object.prototype session-key pollution does not create rows or preference values', () => {
  const id='__dsh_test_inherited_session_id__';
  const injected={...summary(id),state:'ready',values:{subagentCatalog:[]}};
  assert.equal(Object.hasOwn(Object.prototype,id),false);
  Object.defineProperty(Object.prototype,id,{value:injected,writable:true,configurable:true});
  try {
    assert.deepEqual(core.buildRows({ids:[id],byId:{},projectionsBySession:{}},new Set(),new Set(),new Map()),[]);
    const list={phase:'ready',ids:[id],byId:{[id]:summary(id)},projectionsBySession:{}};
    const rows=core.buildRows(list,new Set(),new Set(),new Map());
    assert.equal(rows.length,1); assert.equal(rows[0].catalogState,'unloaded');
    assert.equal(core.avatarType({id,title:'normal'},{}),'lead');
    states=[];stateIndex=0;let registration;
    applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},sessions:{refreshProjections(){},refresh(){}},uiWorkspace:{openSession(){}}});
    const actions=registration.options.inject();actions.expansion.add(id);
    const props={...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
    const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
    assert.equal(flatten(registration.component(props)).some(node=>node.props?.role==='alert'),false);
  } finally {Reflect.deleteProperty(Object.prototype,id);}
});

test('component persists and resets prototype-named avatar IDs without false errors', () => {
  const beforeWindow=globalThis.window, values=new Map();
  globalThis.window={localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}};
  try {
    for(const id of ['__proto__','constructor','toString']) {
      states=[];stateIndex=0;
      let registration;
      applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},sessions:{refreshProjections(){},refresh(){}},uiWorkspace:{openSession(){}}});
      const list={phase:'ready',ids:[id],byId:{[id]:summary(id)},projectionsBySession:{}};
      const props={...registration.options.inject(),useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
      const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
      const render=()=>{stateIndex=0;return flatten(registration.component(props));};
      let nodes=render(), select=nodes.find(node=>node.props?.className==='avatar-select');
      assert.equal(select.props.value,'',id);
      assert.ok(nodes.find(node=>node.type==='img'&&node.props.className==='image').props.src,id);
      select.props.onChange({target:{value:'code'}});nodes=render();
      assert.equal(JSON.parse(values.get('dsh-session-tree.avatar-types.v1'))[id],'code',id);
      assert.equal(nodes.find(node=>node.props?.className==='avatar-select').props.value,'code');
      // Remount the component to exercise the JSON read path, not just its in-memory state.
      states=[];nodes=render();
      assert.equal(nodes.find(node=>node.props?.className==='avatar-select').props.value,'code',id);
      nodes.find(node=>node.props?.className==='avatar-select').props.onChange({target:{value:''}});
      assert.equal(Object.hasOwn(JSON.parse(values.get('dsh-session-tree.avatar-types.v1')),id),false,id);
    }
  } finally {globalThis.window=beforeWindow;}
});

test('prototype-named roots show only their own genuine refresh errors', async () => {
  for (const id of ['__proto__','constructor','toString']) {
    states=[];effects=[];pendingEffects=[];stateIndex=0;let registration, shouldFail=true;
    applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},sessions:{refreshProjections(){return shouldFail ? Promise.reject(Error(`real ${id} failure`)) : Promise.resolve();},refresh(){}},uiWorkspace:{openSession(){}}});
    const list={phase:'ready',ids:[id],byId:{[id]:summary(id)},projectionsBySession:{[id]:{state:'loading',values:{subagentCatalog:[]}}}};
    const actions=registration.options.inject();
    const props={...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
    const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
    const render=()=>{stateIndex=0;pendingEffects=[];const nodes=flatten(registration.component(props));commitMockEffects();return nodes;};
    let nodes=render();
    nodes.find(node=>node.props?.className==='caret').props.onClick({currentTarget:{closest(){}}});
    await new Promise(resolve=>setImmediate(resolve));
    nodes=render();
    assert.ok(nodes.some(node=>node.props?.role==='alert'&&node.children.some(text=>typeof text==='string'&&text.includes(`real ${id} failure`))),id);
    shouldFail=false;
    nodes.find(node=>node.type==='button'&&node.children.includes('重试')).props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    nodes=render();
    assert.equal(nodes.some(node=>node.props?.role==='alert'),false,id);
    assert.equal(nodes.some(node=>node.props?.role==='status'&&node.children.includes('正在读取子代理目录…')),true,id);
  }
});

test('loaded conflicts produce distinct, non-navigable, non-expandable occurrence rows', () => {
  const list = baseList();
  list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = {
    root: ready([child('shared'), child('shared')]),
    other: ready([child('shared')]),
    shared: ready([child('descendant')])
  };
  const rows = core.buildRows(list, new Set(['root', 'shared']), new Set(), new Map());
  const conflicts = rows.filter(row => row.ambiguous);
  assert.equal(conflicts.filter(row => row.id === 'shared').length, 2);
  assert.ok(conflicts.every(row => !row.expandable && !row.expanded && core.navigationTarget(row) === null));
  assert.equal(rows.some(row => row.id === 'descendant'), false);
  assert.equal(new Set(rows.map(row => row.rowKey)).size, rows.length);
  assert.deepEqual(rows.map(row => row.rowKey), core.buildRows(list, new Set(['root', 'shared']), new Set(), new Map()).map(row => row.rowKey));
});

test('unknown or missing child mode never navigates or expands without confirmed identity', () => {
  const list = baseList();
  list.projectionsBySession = { root: ready([child('unknown','unknown'), {id:'missing',label:'missing'}, child('bad','bogus')]), unknown: ready([child('nested')]) };
  const rows = core.buildRows(list, new Set(['root','unknown']), new Set(), new Map());
  for (const row of rows.filter(row => row.parentId === 'root')) {
    assert.equal(core.navigationTarget(row), null);
    assert.equal(row.expandable, false);
    assert.equal(row.unknownMode, true);
  }
  assert.equal(rows.some(row => row.id === 'nested'), false);
});

test('two closed-over parents share no guessed target even if only one is expanded', () => {
  const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = { root: ready([child('shared')]), other: ready([child('shared')]) };
  const rows = core.buildRows(list, new Set(['root']), new Set(), new Map());
  const shared = rows.find(row => row.id === 'shared');
  assert.equal(shared.ambiguous, true);
  assert.equal(core.navigationTarget(shared), null);
  assert.equal(shared.expandable, false);
});

test('new cached conflicts revoke navigation and clearing evidence restores it', () => {
  const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = { root: ready([child('shared')]), other: ready([]) };
  const rows = () => core.buildRows(list, new Set(['root']), new Set(), new Map());
  assert.deepEqual(core.navigationTarget(rows().find(row => row.id === 'shared')), { parentSessionId:'root', childSessionId:'shared', mode:'continuable' });
  list.projectionsBySession.other = {state:'error',values:{subagentCatalog:[child('shared')]}};
  const conflict = rows().find(row => row.id === 'shared');
  assert.equal(conflict.ambiguous,true); assert.equal(core.navigationTarget(conflict),null);
  list.projectionsBySession.other = ready([]);
  assert.equal(rows().find(row => row.id === 'shared').ambiguous,false);
});

test('deep visible chain is bounded, translated, and cannot request another level', () => {
  states = []; stateIndex = 0;
  const list = baseList(), calls = [], registrations = [];
  for (let i = 0; i < 130; i++) list.projectionsBySession[i === 0 ? 'root' : `n${i}`] = ready([child(`n${i+1}`)]);
  const expansion = new Set(['root', ...Array.from({length:129}, (_,i) => `n${i+1}`)]);
  const rows = core.buildRows(list,expansion,new Set(),new Map());
  assert.equal(rows.length,128);
  assert.equal(rows[127].id,'n127');
  assert.equal(rows[127].depthLimit,true);
  assert.equal(rows[127].expandable,false);
  assert.equal(rows[127].expanded,false);
  assert.equal(rows.some(row => row.id === 'n128'),false);
  const locale = mockLocale();
  applyPlugin({ locale, slots:{inject(_name,callback) {callback();},register(options,component){registrations.push({options,component});}},
    sessions:{refreshProjections(id) { calls.push(id); },refresh() {}},uiWorkspace:{openSession() {}} });
  const main = registrations.find(item => item.options.name === 'main'), actions = main.options.inject();
  for (const id of expansion) actions.expansion.add(id);
  const props = {...actions,useSessions:selector => selector(list),useSessionStatus:selector => selector(new Map()),useWorkspaces:selector => selector({archivedSessionIds:[]})};
  const flatten = node => node && typeof node === 'object' ? [node,...(node.children ?? []).flat(Infinity).flatMap(flatten)] : [];
  for (const [language, warning] of [['zh','达到显示深度上限'],['en','Display depth limit reached']]) {
    locale.setLanguage(language); stateIndex = 0;
    const nodes = flatten(main.component(props));
    const last = nodes.find(node => node.props?.['data-session-id'] === 'n127');
    assert.ok(last.props['aria-label'].includes(warning));
    const caret = flatten(last).find(node => node.props?.className === 'caret');
    assert.equal(caret.props.disabled,true);
    caret.props.onClick({currentTarget:{closest(){return null;}}});
    assert.deepEqual(calls,[]);
  }
});

test('closing a visible root never crosses blocked modes, stale expanded edges or independent roots', async () => {
  for (const mode of ['unknown','external',undefined,'invalid']) {
    const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
    list.projectionsBySession = { root:ready([child('barrier',mode)]), barrier:ready([child('other')]), other:ready([child('leaf')]) };
    if (mode === undefined) list.projectionsBySession.root.values.subagentCatalog[0].mode = undefined;
    const expanded = new Set(['root','barrier','other']);
    const rows = core.buildRows(list,expanded,new Set(),new Map());
    assert.deepEqual(rows.map(row=>row.id),['root','barrier','other','leaf']);
    const root = rows[0];
    await core.toggleBranch(root,expanded,async()=>{throw Error('unexpected refresh');},rows);
    assert.deepEqual([...expanded],['barrier','other'],String(mode));
  }
});

test('collapse respects ambiguous and migration boundaries and clears only visible expanded nodes', async () => {
  for (const boundary of ['ambiguous','migration']) {
    const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
    list.projectionsBySession = {root:ready([child('a'),child('block')]), a:ready([child('inner')]), block:ready([child('other')]), other:ready([child('leaf')])};
    if (boundary === 'ambiguous') list.projectionsBySession.root.values.subagentCatalog.push(child('block'));
    else list.byId.block = summary('block',{origin:'subagent',formatStatus:'migration-required'});
    const expanded = new Set(['root','a','block','other']);
    const rows = core.buildRows(list,expanded,new Set(),new Map());
    const block = rows.find(row=>row.id==='block');
    assert.equal(block.expandable,false);
    await core.toggleBranch(rows[0],expanded,async()=>{throw Error('unexpected refresh');},rows);
    assert.deepEqual([...expanded],['block','other'],boundary);
  }
});

test('closing one root preserves another while clearing its legitimate visible multilevel subtree', async () => {
  const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = {root:ready([child('a')]),a:ready([child('deep')]),deep:ready([child('leaf')]),other:ready([child('b')]),b:ready([child('c')])};
  const expanded = new Set(['root','a','deep','other','b']);
  const rows = core.buildRows(list,expanded,new Set(),new Map());
  await core.toggleBranch(rows.find(row=>row.id==='root'),expanded,async()=>{throw Error('unexpected');},rows);
  assert.deepEqual([...expanded],['other','b']);
});

test('closing a stale collapsed node does not traverse its unseen descendants', async () => {
  const list = baseList();
  list.projectionsBySession = { root:ready([child('a')]), a:ready([child('hidden')]), hidden:ready([child('more')]) };
  const expanded = new Set(['root','hidden']);
  const rows = core.buildRows(list,expanded,new Set(),new Map());
  await core.toggleBranch(rows[0],expanded,async()=>{throw Error('unexpected refresh');},rows);
  assert.deepEqual([...expanded],['hidden']);
});

test('ambiguous and cyclic root rows cannot collapse or disturb another root', async () => {
  const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = {root:ready([child('a')]),a:ready([child('root')]),other:ready([child('leaf')])};
  const expanded = new Set(['root','a','other']);
  const rows = core.buildRows(list,expanded,new Set(),new Map());
  assert.equal(rows[0].ambiguous,true);
  await core.toggleBranch(rows[0],expanded,async()=>{throw Error('unexpected');},rows);
  assert.deepEqual([...expanded],['root','a','other']);
});

test('closing a large synthetic visible subtree is iterative and stops at the next root', async () => {
  const rows = Array.from({length:15000}, (_,i) => ({id:`node${i}`,rowKey:`key${i}`,level:i+1,expandable:true,expanded:true,ambiguous:false}));
  rows.push({id:'other',rowKey:'other-key',level:1,expandable:true,expanded:true,ambiguous:false});
  const expanded = new Set(rows.map(row=>row.id)); let calls = 0;
  await core.toggleBranch(rows[0], expanded, async () => { calls++; }, rows);
  assert.deepEqual([...expanded],['other']);
  assert.equal(calls,0);
});

test('length-prefixed row identities distinguish adversarial ids and paths', () => {
  const list = baseList(), tricky = ['a/1:b:0', 'a', '1:x:0', '💡', '\ud800', 'x:y/z', 'x:y/z'];
  list.projectionsBySession.root = ready(tricky.map(id => child(id)));
  list.projectionsBySession.a = ready([child('b'),child('💡')]);
  const expanded = new Set(['root','a']);
  const rows = core.buildRows(list,expanded,new Set(),new Map());
  assert.equal(new Set(rows.map(row => row.rowKey)).size,rows.length);
  assert.notEqual(rows.find(row => row.id === 'a/1:b:0').rowKey,rows.find(row => row.id === 'b').rowKey);
  const uniqueKeys = Object.fromEntries(rows.filter(row => row.id !== 'x:y/z').map(row => [`${row.parentId}:${row.id}`,row.rowKey]));
  list.projectionsBySession.root = ready([...tricky].reverse().map(id => child(id)));
  const reordered = core.buildRows(list,expanded,new Set(),new Map());
  assert.equal(new Set(reordered.map(row => row.rowKey)).size,reordered.length);
  assert.deepEqual(Object.fromEntries(reordered.filter(row => row.id !== 'x:y/z').map(row => [`${row.parentId}:${row.id}`,row.rowKey])),uniqueKeys);
});

test('stable row identity does not change when unrelated siblings or roots reorder', () => {
  const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = { root: ready([child('a'),child('b')]), other: ready([]) };
  const keys = () => Object.fromEntries(core.buildRows(list,new Set(['root']),new Set(),new Map()).map(row => [`${row.parentId}:${row.id}`,row.rowKey]));
  const before = keys();
  list.ids.reverse(); list.projectionsBySession.root = ready([child('b'),child('a')]);
  assert.deepEqual(keys(),before);
});

test('root-to-child cycle marks the root itself ambiguous without recursing', () => {
  const list = baseList();
  list.projectionsBySession = { root: ready([child('a')]), a: ready([child('root')]) };
  const rows = core.buildRows(list, new Set(['root','a']), new Set(), new Map());
  assert.deepEqual(rows.map(row => row.id), ['root']);
  assert.equal(rows[0].ambiguous, true);
  assert.equal(core.navigationTarget(rows[0]), null);
  assert.equal(rows[0].expandable, false);
});

test('root targeted by a different root is ambiguous on both visible occurrences', () => {
  const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = { root: ready([]), other: ready([child('root')]) };
  const rows = core.buildRows(list, new Set(['other']), new Set(), new Map());
  const occurrences = rows.filter(row => row.id === 'root');
  assert.equal(occurrences.length,2);
  assert.ok(occurrences.every(row => row.ambiguous && !row.expandable && core.navigationTarget(row) === null));
  assert.notEqual(occurrences[0].rowKey,occurrences[1].rowKey);
});

test('component collapse preserves another root behind an unknown-mode cached edge', () => {
  states = []; stateIndex = 0;
  const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = {root:ready([child('barrier','unknown')]),barrier:ready([child('other')]),other:ready([child('leaf')])};
  let registration;
  applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},
    sessions:{refreshProjections(){throw Error('unexpected refresh');},refresh(){}},uiWorkspace:{openSession(){}}});
  const actions = registration.options.inject(); for (const id of ['root','barrier','other']) actions.expansion.add(id);
  const props = {...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
  const flatten = node => node && typeof node === 'object' ? [node,...(node.children ?? []).flat(Infinity).flatMap(flatten)] : [];
  function render(){stateIndex=0;return flatten(registration.component(props));}
  let rows = render().filter(node=>node.props?.role==='treeitem');
  const root = rows.find(row=>row.props['data-session-id']==='root');
  root.props.onKeyDown({key:'ArrowLeft',target:1,currentTarget:1,preventDefault(){}});
  rows = render().filter(node=>node.props?.role==='treeitem');
  assert.deepEqual(rows.map(row=>row.props['data-session-id']),['root','other','leaf']);
  assert.equal(rows.find(row=>row.props['data-session-id']==='other').props['aria-expanded'],true);
  assert.deepEqual([...actions.expansion],['barrier','other']);
});

function avatarHarness({ strict = false, storage, decoder = 'auto', readFailure = false } = {}) {
  states = []; effects = []; pendingEffects = []; stateIndex = 0; mountedForTest = true; postUnmountUpdates = 0;
  const previousWindow = globalThis.window, previousReader = globalThis.FileReader, previousImage = globalThis.Image;
  const values = storage ?? new Map(), readers = [], writes = [];
  let failWrites = false, failReads = readFailure, unmounted = false;
  globalThis.window = {localStorage:{getItem(key){if(failReads)throw Error('blocked');return values.get(key) ?? null;},setItem(key,value){ if(failWrites) throw Error('blocked'); values.set(key,value); writes.push([key,value]); }}};
  globalThis.FileReader = class {
    constructor(){readers.push(this);}
    readAsDataURL(file){this.file=file;}
    finish(value){this.result=value;this.onload?.();}
    fail(){this.onerror?.();}
  };
  if(decoder==='auto')globalThis.Image=class {constructor(){this.naturalWidth=144;this.naturalHeight=144;}decode(){return Promise.resolve();}};
  let registration;
  applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},sessions:{},uiWorkspace:{}});
  const actions = registration.options.inject(), list = baseList();
  const props = {...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
  const flatten = node => node && typeof node === 'object' ? [node,...(node.children ?? []).flat(Infinity).flatMap(flatten)] : [];
  function render(){
    stateIndex=0; pendingEffects=[];
    const nodes=flatten(registration.component(props));
    for(const effect of pendingEffects){
      const first=!effects[effect.index]; effects[effect.index]?.cleanup?.();
      let cleanup=effect.callback(); if(strict&&first){cleanup?.();cleanup=effect.callback();}
      effects[effect.index]={deps:effect.deps,cleanup,setup:effect.callback,layout:effect.layout};
    }
    return nodes;
  }
  function select(type){const nodes=render();nodes.find(node=>node.type==='select' && node.props.value && ['lead','research','code','write','data','qa'].includes(node.props.value)).props.onChange({target:{value:type}});}
  function upload(){const nodes=render();nodes.find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:[{type:'image/png',size:10}],value:'x'}});return readers.at(-1);}
  function reset(){const nodes=render();nodes.find(node=>node.type==='button'&&node.children.includes('恢复内置图')).props.onClick();}
  function notice(){return render().filter(node=>node.props?.role==='status').flatMap(node=>node.children).filter(value=>typeof value==='string').join(' ');}
  function stored(){return JSON.parse(values.get('dsh-session-tree.avatar-images.v1') ?? '{}');}
  let layoutGone=false, passiveGone=false;
  function layoutUnmount(){if(layoutGone)return;for(const effect of effects)if(effect?.layout)effect.cleanup?.();layoutGone=true;unmounted=true;mountedForTest=false;}
  function passiveUnmount(){if(passiveGone)return;for(const effect of effects)if(effect && !effect.layout)effect.cleanup?.();passiveGone=true;}
  function unmount(){layoutUnmount();passiveUnmount();}
  function dispose(){unmount();mountedForTest=true;globalThis.window=previousWindow;globalThis.FileReader=previousReader;globalThis.Image=previousImage;}
  return {render,select,upload,reset,notice,stored,readers,writes,layoutUnmount,passiveUnmount,unmount,dispose,updatesAfterUnmount:()=>postUnmountUpdates,setFail(value){failWrites=value;},setReadFail(value){failReads=value;}};
}
test('upload requires asynchronous native decode and never mistakes old notice for success', async () => {
  const previousImage=globalThis.Image, decoders=[];
  globalThis.Image=class {constructor(){decoders.push(this);this.naturalWidth=144;this.naturalHeight=144;this.wait=deferred();}decode(){return this.wait.promise;}};
  const app=avatarHarness({decoder:'external'});
  try {
    app.upload().finish(pngA);
    assert.deepEqual(app.stored(),{});
    assert.match(app.notice(),/正在验证头像/);
    assert.equal(decoders.length,1);
    decoders[0].wait.resolve();await flushRefresh();
    assert.deepEqual(app.stored(),{lead:pngA});
    assert.match(app.notice(),/已保存在此浏览器/);
    app.upload();assert.match(app.notice(),/正在验证头像/);
  } finally {app.dispose();globalThis.Image=previousImage;}
});

test('malformed image storage cannot be overwritten by reset or upload', () => {
  for(const raw of ['broken-json','null','[]','123','"text"']) {
    const storage=new Map([['dsh-session-tree.avatar-images.v1',raw]]),app=avatarHarness({storage});
    try {app.reset();assert.equal(storage.get('dsh-session-tree.avatar-images.v1'),raw);assert.match(app.notice(),/头像无法保存/);}
    finally {app.dispose();}
  }
  const storage=new Map([['dsh-session-tree.avatar-images.v1','{"lead":"untouched"}']]);
  const app=avatarHarness({storage,readFailure:true});
  try {app.render();app.setReadFail(false);app.reset();assert.equal(storage.get('dsh-session-tree.avatar-images.v1'),'{"lead":"untouched"}');assert.match(app.notice(),/头像无法保存/);}
  finally {app.dispose();}
});

test('corrupt storage blocks even a successfully decoded replacement', async () => {
  const raw='{"broken":',storage=new Map([['dsh-session-tree.avatar-images.v1',raw]]),app=avatarHarness({storage});
  try {app.upload().finish(pngB);await flushRefresh();assert.equal(storage.get('dsh-session-tree.avatar-images.v1'),raw);assert.equal(app.writes.length,0);assert.match(app.notice(),/头像无法保存/);}
  finally {app.dispose();}
});

test('potentially lossy image JSON round trips refuse reset without touching raw text', () => {
  const cases=[
    '{"future":{"n":1e400}}',
    '{"future":{"n":9007199254740993}}',
    '{"future":[{"n":-0}]}',
    '{"future":1.0}',
    '{"future":1e0}',
    '{"future":1,"future":2}',
    '{"future":1,"\\u0066uture":2}',
    '{"future":"\\u0061"}',
    '{"future":"two  spaces" ,"n":-0}',
    '{"10":"ten","2":"two"}',
    '{"future":{"nested":[{"n":1e400}]}}',
  ];
  for(const raw of cases) {
    const storage=new Map([['dsh-session-tree.avatar-images.v1',raw]]),app=avatarHarness({storage});
    try {
      app.reset();
      assert.equal(storage.get('dsh-session-tree.avatar-images.v1'),raw,raw);
      assert.equal(app.writes.length,0,raw);
      assert.match(app.notice(),/头像无法保存/);
    } finally {app.dispose();}
  }
});

test('unsafe round-trip image JSON also rejects a decoded upload', async () => {
  const raw=' { "future" : [9007199254740993] } ',storage=new Map([['dsh-session-tree.avatar-images.v1',raw]]),app=avatarHarness({storage});
  try {
    app.upload().finish(pngB);await flushRefresh();
    assert.equal(storage.get('dsh-session-tree.avatar-images.v1'),raw);
    assert.equal(app.writes.length,0);assert.match(app.notice(),/头像无法保存/);
  } finally {app.dispose();}
});

test('safe image JSON whitespace, escaped quotes and backslashes preserve unknown values', () => {
  const parsed={lead:'legacy',future:{text:'space \t quote " slash \\ end',number:42,arr:[0,true,null]}};
  const raw=' \n'+JSON.stringify(parsed,null,2)+'\r\n',storage=new Map([['dsh-session-tree.avatar-images.v1',raw]]),app=avatarHarness({storage});
  try {app.select('code');app.reset();assert.deepEqual(app.stored(),parsed);assert.equal(app.writes.length,1);}
  finally {app.dispose();}
});

test('legacy and unknown image fields survive a different type reset', () => {
  const raw='{"lead":"broken-legacy","extra":{"nested":1},"__proto__":{"x":1},"code":"legacy-code"}';
  const storage=new Map([['dsh-session-tree.avatar-images.v1',raw]]),app=avatarHarness({storage});
  try {
    app.select('code');app.reset();
    const saved=JSON.parse(storage.get('dsh-session-tree.avatar-images.v1'));
    assert.equal(saved.lead,'broken-legacy');assert.deepEqual(saved.extra,{nested:1});
    assert.equal(Object.hasOwn(saved,'__proto__'),true);assert.deepEqual(saved.__proto__,{x:1});
    assert.equal(Object.hasOwn(saved,'code'),false);
  } finally {app.dispose();}
});

test('legacy render error falls back by committed revision and does not delete stored data', async () => {
  const storage=new Map([['dsh-session-tree.avatar-images.v1',JSON.stringify({lead:pngB,code:pngC,extra:'untouched'})]]);
  const previousImage=globalThis.Image,decoders=[];
  globalThis.Image=class {constructor(){decoders.push(this);this.naturalWidth=144;this.naturalHeight=144;this.wait=deferred();}decode(){return this.wait.promise;}};
  const app=avatarHarness({storage,decoder:'external'});
  try {
    const first=app.render().find(node=>node.type==='img'&&node.props.className==='image');
    assert.equal(first.props.src,pngB);assert.equal(typeof first.props.onError,'function');
    app.upload().finish(pngB);decoders[0].wait.resolve();await flushRefresh();
    const latest=app.render().find(node=>node.type==='img'&&node.props.className==='image');
    first.props.onError({currentTarget:{src:pngB}});
    assert.equal(app.render().find(node=>node.type==='img'&&node.props.className==='image').props.src,pngB);
    latest.props.onError({currentTarget:{src:pngB}});
    const fallback=app.render().find(node=>node.type==='img'&&node.props.className==='image');
    assert.notEqual(fallback.props.src,pngB);
    assert.equal(fallback.props.onError,undefined);
    assert.deepEqual(app.stored(),{lead:pngB,code:pngC,extra:'untouched'});
  } finally {app.dispose();globalThis.Image=previousImage;}
});

test('decode completion obeys selection, reset, cross-type and unmount fences', async () => {
  const previousImage=globalThis.Image, decoders=[];
  globalThis.Image=class {constructor(){decoders.push(this);this.naturalWidth=144;this.naturalHeight=144;this.wait=deferred();}decode(){return this.wait.promise;}};
  const app=avatarHarness({decoder:'external'});
  try {
    app.upload().finish(pngA);app.upload().finish(pngB);
    decoders[1].wait.resolve();await flushRefresh();decoders[0].wait.resolve();await flushRefresh();
    assert.equal(app.stored().lead,pngB);
    app.upload().finish(pngA);app.reset();decoders[2].wait.resolve();await flushRefresh();
    assert.equal(Object.hasOwn(app.stored(),'lead'),false);
    app.upload().finish(pngA);app.select('code');app.upload().finish(pngB);
    decoders[4].wait.resolve();decoders[3].wait.resolve();await flushRefresh();
    assert.deepEqual(app.stored(),{lead:pngA,code:pngB});
    app.upload().finish(pngC);const writes=app.writes.length;app.layoutUnmount();decoders[5].wait.resolve();await flushRefresh();
    assert.equal(app.writes.length,writes);assert.equal(app.updatesAfterUnmount(),0);
  } finally {app.dispose();globalThis.Image=previousImage;}
});

test('layout replay fences decode already pending and new intent still succeeds', async () => {
  const previousImage=globalThis.Image,decoders=[];
  globalThis.Image=class {constructor(){decoders.push(this);this.naturalWidth=144;this.naturalHeight=144;this.wait=deferred();}decode(){return this.wait.promise;}};
  const app=avatarHarness({decoder:'external'});
  try {
    app.upload().finish(pngA);
    const effect=effects.find(item=>item?.layout);effect.cleanup();effect.cleanup=effect.setup();
    decoders[0].wait.resolve();await flushRefresh();assert.deepEqual(app.stored(),{});
    app.upload().finish(pngB);decoders[1].wait.resolve();await flushRefresh();assert.equal(app.stored().lead,pngB);
  } finally {app.dispose();globalThis.Image=previousImage;}
});

test('legacy and unknown fields survive upload and a failed save leaves current value intact', async () => {
  const storage=new Map([['dsh-session-tree.avatar-images.v1','{"lead":"bad-legacy","future":{"x":1},"__proto__":{"kept":true}}']]);
  const app=avatarHarness({storage});
  try {
    app.select('code');app.upload().finish(pngB);await flushRefresh();
    let saved=app.stored();assert.equal(saved.lead,'bad-legacy');assert.deepEqual(saved.future,{x:1});assert.deepEqual(saved.__proto__,{kept:true});assert.equal(saved.code,pngB);
    const original=storage.get('dsh-session-tree.avatar-images.v1');app.setFail(true);app.upload().finish(pngC);await flushRefresh();
    assert.equal(storage.get('dsh-session-tree.avatar-images.v1'),original);
    assert.match(app.notice(),/头像无法保存/);
  } finally {app.dispose();}
});

test('upload rejects structurally bad PNG and dimension excess before decode starts', () => {
  const previousImage=globalThis.Image;let calls=0;
  globalThis.Image=class {constructor(){calls++;}decode(){return Promise.resolve();}};
  const app=avatarHarness({decoder:'external'});
  try {
    const cases=[['data:image/png;base64,iVBORw0KGgo=','无法验证或解码'],[pngUrl(avatarBytesA.subarray(0,-12)),'无法验证或解码']];
    const big=Buffer.from(avatarBytesA);big.writeUInt32BE(2049,16);cases.push([pngUrl(big),'宽高各不能超过 2048']);
    for(const [data,message] of cases){app.upload().finish(data);assert.match(app.notice(),new RegExp(message));}
    assert.equal(calls,0);assert.deepEqual(app.stored(),{});
  } finally {app.dispose();globalThis.Image=previousImage;}
});

test('legacy image failure is isolated by avatar type', () => {
  const storage=new Map([['dsh-session-tree.avatar-images.v1',JSON.stringify({lead:pngB,code:pngC})]]),app=avatarHarness({storage});
  try {
    const select=app.render().find(node=>node.props?.className==='avatar-select');select.props.onChange({target:{value:'code'}});
    const code=app.render().find(node=>node.type==='img'&&node.props.className==='image');assert.equal(code.props.src,pngC);
    code.props.onError({currentTarget:{src:pngC}});
    const leadSelect=app.render().find(node=>node.props?.className==='avatar-select');leadSelect.props.onChange({target:{value:'lead'}});
    assert.equal(app.render().find(node=>node.type==='img'&&node.props.className==='image').props.src,pngB);
    assert.deepEqual(app.stored(),{lead:pngB,code:pngC});
  } finally {app.dispose();}
});

test('failed upload does not invalidate old image error fallback', async () => {
  const storage=new Map([['dsh-session-tree.avatar-images.v1',JSON.stringify({lead:pngB})]]),app=avatarHarness({storage});
  try {
    const old=app.render().find(node=>node.type==='img'&&node.props.className==='image');
    app.setFail(true);app.upload().finish(pngC);await flushRefresh();
    old.props.onError({currentTarget:{src:pngB}});
    assert.notEqual(app.render().find(node=>node.type==='img'&&node.props.className==='image').props.src,pngB);
    assert.equal(app.stored().lead,pngB);
  } finally {app.dispose();}
});

test('legacy precheck excludes oversized or animated images without changing raw storage', () => {
  const big=Buffer.from(avatarBytesA);big.writeUInt32BE(2049,16);
  const animated=insertBeforeIend(avatarBytesA,pngChunk('acTL'));
  const raw=JSON.stringify({lead:pngUrl(big),code:pngUrl(animated),extra:'keep'}),storage=new Map([['dsh-session-tree.avatar-images.v1',raw]]);
  const app=avatarHarness({storage});
  try {
    const image=app.render().find(node=>node.type==='img'&&node.props.className==='image');
    assert.notEqual(image.props.src,pngUrl(big));assert.equal(image.props.onError,undefined);
    assert.equal(storage.get('dsh-session-tree.avatar-images.v1'),raw);
    app.select('write');app.reset();assert.deepEqual(app.stored(),JSON.parse(raw));
  } finally {app.dispose();}
});

test('legacy render error handler remains valid across layout replay and never affects other type', () => {
  const storage=new Map([['dsh-session-tree.avatar-images.v1',JSON.stringify({lead:pngB,code:pngC})]]),app=avatarHarness({storage});
  try {
    const before=app.render().find(node=>node.type==='img'&&node.props.className==='image');
    const layout=effects.find(effect=>effect?.layout);layout.cleanup();layout.cleanup=layout.setup();
    before.props.onError({currentTarget:{src:pngB}});
    assert.notEqual(app.render().find(node=>node.type==='img'&&node.props.className==='image').props.src,pngB);
    assert.equal(app.stored().code,pngC);
  } finally {app.dispose();}
});

test('stale decode rejection cannot overwrite newer successful operation notice', async () => {
  const previousImage=globalThis.Image,decoders=[];
  globalThis.Image=class {constructor(){decoders.push(this);this.naturalWidth=144;this.naturalHeight=144;this.wait=deferred();}decode(){return this.wait.promise;}};
  const app=avatarHarness({decoder:'external'});
  try {
    app.upload().finish(pngA);app.upload().finish(pngB);
    decoders[1].wait.resolve();await flushRefresh();
    assert.equal(app.stored().lead,pngB);assert.match(app.notice(),/已保存在此浏览器/);
    decoders[0].wait.reject(Error('stale'));await flushRefresh();
    assert.equal(app.stored().lead,pngB);assert.match(app.notice(),/已保存在此浏览器/);
  } finally {app.dispose();globalThis.Image=previousImage;}
});

test('decoder rejection, unsupported API or changed size preserves committed image', async () => {
  const previousImage=globalThis.Image, decoders=[];
  globalThis.Image=class {constructor(){decoders.push(this);this.naturalWidth=144;this.naturalHeight=144;this.wait=deferred();}decode(){return this.wait.promise;}};
  const app=avatarHarness({decoder:'external'});
  try {
    app.upload().finish(pngA);decoders[0].wait.resolve();await flushRefresh();
    const duplicate=pngUrl(insertBeforeIend(avatarBytesB,pngChunk('IHDR',avatarBytesB.subarray(16,29))));
    app.upload().finish(duplicate);assert.equal(decoders.length,1);assert.equal(app.stored().lead,pngA);
    app.upload().finish(pngB);decoders[1].wait.reject(Error('bad image'));await flushRefresh();
    assert.deepEqual(app.stored(),{lead:pngA});assert.match(app.notice(),/PNG/);
    app.upload().finish(pngB);decoders[2].naturalWidth=145;decoders[2].wait.resolve();await flushRefresh();
    assert.deepEqual(app.stored(),{lead:pngA});
    for(const Broken of [class {},class {set src(_){throw Error('blocked');}},class {decode(){throw Error('blocked');}},class {decode(){return undefined;}}]) {
      globalThis.Image=Broken;app.upload().finish(pngC);await flushRefresh();
      assert.deepEqual(app.stored(),{lead:pngA});assert.match(app.notice(),/无法验证或解码/);
    }
  } finally {app.dispose();globalThis.Image=previousImage;}
});

test('avatar readers merge different types in either completion order', async () => {
  for(const reverse of [false,true]) {
    const app=avatarHarness();
    try {
      const lead=app.upload(); app.select('code'); const code=app.upload();
      if(reverse){code.finish(pngB);lead.finish(pngA);}else{lead.finish(pngA);code.finish(pngB);}
      await flushRefresh();
      assert.deepEqual(app.stored(),{lead:pngA,code:pngB});
      assert.ok(app.notice().includes('开发头像已保存在此浏览器'));
    } finally {app.dispose();}
  }
});

test('same-type latest upload and reset invalidate earlier readers', async () => {
  const app=avatarHarness();
  try {
    const first=app.upload(), second=app.upload(); second.finish(pngB); first.finish(pngA);await flushRefresh();
    assert.deepEqual(app.stored(),{lead:pngB});
    const pending=app.upload(); app.reset(); pending.finish(pngC);
    assert.deepEqual(app.stored(),{});
    assert.ok(app.notice().includes('组长 / 默认头像已恢复内置图'));
  } finally {app.dispose();}
});

test('failed reset preserves committed picture but invalidates pending upload', async () => {
  const app=avatarHarness();
  try {
    app.upload().finish(pngA); await flushRefresh();const pending=app.upload(); app.setFail(true); app.reset(); app.setFail(false); pending.finish(pngB);
    assert.deepEqual(app.stored(),{lead:pngA});
    assert.ok(app.notice().includes('头像无法保存'));
  } finally {app.dispose();}
});

test('latest errors suppress old success and failed storage never contaminates later type', async () => {
  const app=avatarHarness();
  try {
    const old=app.upload(), latest=app.upload(); latest.fail(); old.finish(pngA);
    assert.deepEqual(app.stored(),{}); assert.ok(app.notice().includes('无法读取头像图片'));
    app.setFail(true); app.upload().finish(pngA); await flushRefresh();app.setFail(false);
    assert.deepEqual(app.stored(),{}); assert.ok(app.notice().includes('头像无法保存'));
    app.select('code'); app.upload().finish(pngB);await flushRefresh();
    assert.deepEqual(app.stored(),{code:pngB});
  } finally {app.dispose();}
});

test('cross-type writes merge even before React renders again', async () => {
  const app=avatarHarness();
  try {
    const lead=app.upload(); app.select('code'); const code=app.upload();
    code.finish(pngB); lead.finish(pngA);await flushRefresh();
    assert.deepEqual(app.stored(),{code:pngB,lead:pngA});
    const images=app.render().filter(node=>node.type==='img');
    assert.ok(images.some(image=>image.props.src===pngA));
  } finally {app.dispose();}
});

test('newer invalid selections, invalid image contents, and synchronous reader failures fence older work', () => {
  const app=avatarHarness();
  try {
    const old=app.upload();
    const input=app.render().find(node=>node.type==='input'&&node.props.type==='file');
    input.props.onChange({target:{files:[{type:'image/jpeg',size:1}],value:'x'}});
    old.finish(pngA);
    assert.deepEqual(app.stored(),{}); assert.ok(app.notice().includes('请选择不超过 180 KB 的 PNG 图片'));
    app.upload().finish('invalid-png');
    assert.deepEqual(app.stored(),{}); assert.ok(app.notice().includes('无法验证或解码此静态 PNG'));
    const Previous=globalThis.FileReader; globalThis.FileReader=class {readAsDataURL(){throw Error('blocked');}};
    try { app.upload(); assert.ok(app.notice().includes('无法读取头像图片')); } finally {globalThis.FileReader=Previous;}
  } finally {app.dispose();}
});

test('latest operation notice stays authoritative while older different-type upload still commits', async () => {
  const app=avatarHarness();
  try {
    const lead=app.upload(); app.select('code'); const code=app.upload(); code.fail();
    assert.ok(app.notice().includes('无法读取头像图片'));
    lead.finish(pngA);await flushRefresh();
    assert.deepEqual(app.stored(),{lead:pngA});
    assert.ok(app.notice().includes('无法读取头像图片'));
  } finally {app.dispose();}
});

test('single FileReader settles once and ignores later callbacks', async () => {
  const app=avatarHarness();
  try {
    const reader=app.upload(); reader.fail(); reader.finish(pngA);
    assert.deepEqual(app.stored(),{}); assert.ok(app.notice().includes('无法读取头像图片'));
    const success=app.upload(); success.finish(pngB); await flushRefresh();const writes=app.writes.length;
    success.fail(); success.finish(pngC);
    assert.equal(app.writes.length,writes); assert.deepEqual(app.stored(),{lead:pngB});
    assert.ok(app.notice().includes('组长 / 默认头像已保存在此浏览器'));
  } finally {app.dispose();}
});

test('latest image notice guarantee does not order unrelated notices', async () => {
  const app=avatarHarness();
  try {
    const reader=app.upload();
    const select=app.render().find(node=>node.props?.className==='avatar-select');
    app.setFail(true); select.props.onChange({target:{value:'code'}}); app.setFail(false);
    assert.ok(app.notice().includes('头像偏好无法保存'));
    reader.finish(pngA);await flushRefresh();
    assert.ok(app.notice().includes('组长 / 默认头像已保存在此浏览器'));
  } finally {app.dispose();}
});

test('effect replay invalidates pending work while reactivated instance accepts new work', async () => {
  const app=avatarHarness();
  try {
    const old=app.upload();
    const effect=effects.find(item=>item?.layout && typeof item?.cleanup==='function');
    effect.cleanup();
    // React StrictMode setup replay is represented by re-running the captured setup.
    effect.cleanup=effect.setup();
    old.finish(pngA); assert.deepEqual(app.stored(),{});
    app.upload().finish(pngB); await flushRefresh();assert.deepEqual(app.stored(),{lead:pngB});
  } finally {app.dispose();}
});

test('layout unmount fences image success and failure before passive cleanup', () => {
  for(const strict of [false,true]) {
    const app=avatarHarness({strict});
    try {
      const lead=app.upload();app.select('code');const code=app.upload();
      const before=app.writes.length;
      app.layoutUnmount();
      lead.finish(pngA);code.fail();
      assert.equal(app.writes.length,before);
      assert.deepEqual(app.stored(),{});
      assert.equal(app.updatesAfterUnmount(),0);
      app.passiveUnmount();
    } finally {app.dispose();}
  }
});

test('old generation readers stay fenced after layout setup replay', async () => {
  const app=avatarHarness();
  try {
    const lead=app.upload();app.select('code');const code=app.upload();
    const layout=effects.find(effect=>effect?.layout);assert.ok(layout);
    layout.cleanup();layout.cleanup=layout.setup();
    lead.finish(pngA);code.fail();
    assert.deepEqual(app.stored(),{});
    assert.doesNotMatch(app.notice(),/无法读取头像图片/);
    app.upload().finish(pngB);await flushRefresh();
    assert.deepEqual(app.stored(),{code:pngB});
  } finally {app.dispose();}
});

test('old unmounted instance callbacks cannot overwrite a fresh instance', async () => {
  const previousWindow=globalThis.window,previousReader=globalThis.FileReader, shared=new Map();
  const old=avatarHarness({storage:shared});
  let fresh;
  try {
    const pending=old.upload();old.select('code');const oldError=old.upload();old.layoutUnmount();
    fresh=avatarHarness({storage:shared});const freshPending=fresh.upload();
    old.passiveUnmount();
    freshPending.finish(pngB);await flushRefresh();
    const before=fresh.writes.length;
    pending.finish(pngA);oldError.fail();
    assert.equal(fresh.writes.length,before);
    assert.deepEqual(fresh.stored(),{lead:pngB});
    assert.equal(fresh.updatesAfterUnmount(),0);
  } finally {
    fresh?.dispose();old.dispose();globalThis.window=previousWindow;globalThis.FileReader=previousReader;
  }
});

test('unmounted or effect-replayed avatar readers cannot write afterward', () => {
  for(const strict of [false,true]){
    const app=avatarHarness({strict});
    try {
      const reader=app.upload(), before=app.writes.length; app.unmount(); reader.finish(pngA); reader.fail();
      assert.equal(app.writes.length,before); assert.deepEqual(app.stored(),{});
      assert.equal(app.updatesAfterUnmount(),0);
    } finally {app.dispose();}
  }
});

function focusHarness() {
  states=[]; effects=[]; pendingEffects=[]; stateIndex=0;
  const previousDocument=globalThis.document;
  const body={isConnected:true}, outside={isConnected:true}, doc={body,activeElement:body};
  globalThis.document=doc;
  let registration;
  applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},
    sessions:{refreshProjections(){},refresh(){}},uiWorkspace:{openSession(){}}});
  const actions=registration.options.inject(), list=baseList();
  list.ids.push('other');list.byId.other=summary('other');
  list.projectionsBySession={root:ready([child('a')]),a:ready([child('deep')]),deep:ready([]),other:ready([])};
  for(const id of ['root','a'])actions.expansion.add(id);
  const props={...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
  const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
  const nodes=new Map(), tree={querySelectorAll:()=>[...nodes.values()],contains(element){return [...nodes.values()].some(node=>node===element||node.controls.includes(element));}};
  function render({commit=true}={}){
    stateIndex=0;pendingEffects=[];
    const elements=flatten(registration.component(props)), virtual=elements.filter(node=>node.props?.role==='treeitem');
    const scheduled=[...pendingEffects];
    if(commit){
      for(const effect of scheduled.filter(effect=>effect.layout))effects[effect.index]?.cleanup?.();
      const keys=new Set(virtual.map(row=>row.props['data-row-key']));
      for(const [key,node] of nodes)if(!keys.has(key)){
        node.isConnected=false;for(const control of node.controls)control.isConnected=false;
        if(doc.activeElement===node||node.controls.includes(doc.activeElement))doc.activeElement=body;
        nodes.delete(key);
      }
      for(const row of virtual){
        const key=row.props['data-row-key'];let node=nodes.get(key);
        if(!node){node={dataset:{rowKey:key},isConnected:true,controls:[],focus(){doc.activeElement=node;},contains(target){return target===node||node.controls.includes(target);}};nodes.set(key,node);}
        node.virtual=row;
        if(!node.controls.length)node.controls.push({isConnected:true,owner:node});
      }
      const treeRef=states.find(item=>item?.current===null);if(treeRef)treeRef.current=tree;
      for(const effect of scheduled){if(!effect.layout)effects[effect.index]?.cleanup?.();effects[effect.index]={deps:effect.deps,cleanup:effect.callback(),setup:effect.callback};}
    }
    return {virtual,nodes};
  }
  function focus(id,control=false){
    const node=[...nodes.values()].find(item=>item.virtual.props['data-session-id']===id);
    assert.ok(node,`missing ${id}`);
    doc.activeElement=control?node.controls[0]:node;
    node.virtual.props.onFocus({target:doc.activeElement,currentTarget:node});
    return node;
  }
  function dispose(){for(const effect of effects)effect?.cleanup?.();globalThis.document=previousDocument;}
  return {list,render,focus,doc,body,outside,dispose,actions,nodes};
}

test.skip('TODO simulated fixture: dynamic duplicate removes focused descendant; real DOM ordering unverified', () => {
  const app=focusHarness();
  try {
    app.render(); app.focus('deep'); app.render();
    app.list.projectionsBySession.other=ready([child('a')]);
    app.render();
    assert.equal(app.doc.activeElement.virtual.props['data-session-id'],'root');
    const rows=app.render().virtual;
    assert.equal(rows.find(row=>row.props.tabIndex===0).props['data-session-id'],'root');
  } finally {app.dispose();}
});

test.skip('TODO simulated fixture: moved focused subtree changes keys; real DOM ordering unverified', () => {
  const app=focusHarness();
  try {
    app.actions.expansion.add('other'); // Seed before the component copies expansion into state.
    app.render(); app.focus('deep'); app.render();
    app.list.projectionsBySession.root=ready([]);
    app.list.projectionsBySession.other=ready([child('a')]);
    const rows=app.render().virtual;
    assert.ok(rows.some(row=>row.props['data-session-id']==='deep'));
    assert.equal(app.doc.activeElement.virtual.props['data-session-id'],'deep');
  } finally {app.dispose();}
});

test.skip('TODO simulated fixture: focus recovery must not steal outside or row-control focus', () => {
  for(const where of ['outside','control']) {
    const app=focusHarness();
    try {
      app.render(); app.focus('deep'); app.render();
      const target=where==='outside'?app.outside:app.focus('deep',true).controls[0];
      app.doc.activeElement=target;
      app.list.projectionsBySession.other=ready([child('a')]);app.render();
      assert.notEqual(app.doc.activeElement.virtual?.props['data-session-id'],'root');
      if(where==='outside')assert.equal(app.doc.activeElement,target);
    } finally {app.dispose();}
  }
});

test.skip('TODO simulated fixture: removing every root must not focus stale detached rows', () => {
  const app=focusHarness();
  try {app.render();app.focus('deep');app.render();app.list.ids=[];app.render();assert.equal(app.doc.activeElement,app.body);}
  finally {app.dispose();}
});

test('tab stop calculation scans visible rows at most once per render', () => {
  states = []; stateIndex = 0;
  const list = baseList();
  for (let i=0;i<300;i++){const id=`extra-${i}`;list.ids.push(id);list.byId[id]=summary(id);}
  let registration;
  applyPlugin({slots:{inject(_name,callback){callback();},register(options,component){if(options.name==='main')registration={options,component};}},
    sessions:{refreshProjections(){},refresh(){}},uiWorkspace:{openSession(){}}});
  const props={...registration.options.inject(),useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:[]})};
  const previousSome=Array.prototype.some;let rowChecks=0;
  Array.prototype.some=function(predicate,...rest){return previousSome.call(this,(value,index,array)=>{if(value?.rowKey!==undefined)rowChecks++;return predicate(value,index,array);},...rest);};
  let tree;
  try {stateIndex=0;tree=registration.component(props);} finally {Array.prototype.some=previousSome;}
  const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
  const rows=flatten(tree).filter(node=>node.props?.role==='treeitem');
  assert.equal(rows.length,301);
  assert.ok(rowChecks<=rows.length,`row-key comparisons: ${rowChecks}`);
  assert.equal(rows.filter(row=>row.props.tabIndex===0).length,1);
  assert.equal(rows[0].props.tabIndex,0);
});

test('component omits unavailable right-sidebar action on independent main panel', () => {
  states = []; stateIndex = 0;
  const list = baseList();
  list.projectionsBySession.root = ready([child('a')]);
  list.byId.a = summary('a', { origin: 'subagent', parentId: 'root' });
  let registration;
  applyPlugin({
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

test('tree row disabled semantics reflect individually available controls in both languages', () => {
  for(const language of ['zh','en']) {
    states=[];effects=[];pendingEffects=[];stateIndex=0;
    const list=baseList();list.ids.push('archive','migration');list.byId.archive=summary('archive');list.byId.migration=summary('migration',{formatStatus:'migration-required'});
    list.projectionsBySession={root:ready([child('external','external'),child('unknown','unknown'),child('amb'),child('amb'),child('normal')]),archive:{state:'loading',values:{subagentCatalog:[]}}};
    const calls=[],locale=mockLocale();locale.setLanguage(language);let registration;
    applyPlugin({locale,slots:{inject(_name,cb){cb();},register(options,component){if(options.name==='main')registration={options,component};}},sessions:{refreshProjections(){},refresh(){}},uiWorkspace:{openSession(target){calls.push(target);}}});
    const actions=registration.options.inject();actions.expansion.add('root');
    const props={...actions,useSessions:selector=>selector(list),useSessionStatus:selector=>selector(new Map()),useWorkspaces:selector=>selector({archivedSessionIds:['archive']})};
    const flatten=node=>node&&typeof node==='object'?[node,...(node.children??[]).flat(Infinity).flatMap(flatten)]:[];
    const rows=flatten(registration.component(props)).filter(node=>node.props?.role==='treeitem');
    const find=id=>rows.find(row=>row.props['data-session-id']===id);
    const parts=id=>{const nodes=flatten(find(id));return {row:find(id),caret:nodes.find(node=>node.props?.className==='caret'),button:nodes.find(node=>node.props?.className==='body'),select:nodes.find(node=>node.props?.className==='avatar-select')};};
    const expected=language==='zh'?{unavailable:'无法打开会话',archived:'已归档',external:'外部任务',unknown:'模式未知',ambiguous:'身份存在歧义'}:{unavailable:'Cannot open session',archived:'Archived',external:'External task',unknown:'Unknown mode',ambiguous:'Ambiguous identity'};
    for(const [id,state] of [['archive','archived'],['external','external'],['unknown','unknown']]) {
      const {row,button,select}=parts(id);
      assert.notEqual(row.props['aria-disabled'],true,id);
      assert.equal(button.props.disabled,true,id);assert.equal(select.props.disabled,false,id);
      assert.ok(row.props['aria-label'].includes(expected[state]),id);
      assert.ok(row.props['aria-label'].includes(expected.unavailable),id);
      for(const code of ['Enter',' '])row.props.onKeyDown({key:code,target:1,currentTarget:1,preventDefault(){}});
    }
    assert.equal(parts('archive').caret.props.disabled,false);
    assert.equal(parts('archive').row.props['aria-expanded'],false);
    parts('archive').row.props.onKeyDown({key:'ArrowRight',target:1,currentTarget:1,preventDefault(){}});
    assert.equal(actions.expansion.has('archive'),true);
    for(const row of rows.filter(row=>row.props['data-session-id']==='amb')) {
      const controls=flatten(row);
      assert.equal(row.props['aria-disabled'],true);
      assert.ok(row.props['aria-label'].includes(expected.ambiguous));
      assert.ok(row.props['aria-label'].includes(expected.unavailable));
      assert.equal(controls.find(node=>node.props?.className==='caret').props.disabled,true);
      assert.equal(controls.find(node=>node.props?.className==='body').props.disabled,true);
      assert.equal(controls.find(node=>node.props?.className==='avatar-select').props.disabled,true);
      for(const code of ['Enter',' '])row.props.onKeyDown({key:code,target:1,currentTarget:1,preventDefault(){}});
    }
    assert.deepEqual(calls,[]);
    for(const id of ['root','migration','normal']) {
      const {row,button,select}=parts(id);
      assert.notEqual(row.props['aria-disabled'],true,id);
      assert.equal(button.props.disabled,false,id);assert.equal(select.props.disabled,false,id);
      assert.equal(row.props['aria-label'].includes(expected.unavailable),false,id);
    }
    for(const code of ['Enter',' '])parts('normal').row.props.onKeyDown({key:code,target:1,currentTarget:1,preventDefault(){}});
    assert.equal(calls.length,2);
    assert.deepEqual(calls[0],{parentSessionId:'root',childSessionId:'normal',mode:'continuable'});
  }
});

test('ambiguous occurrences use unique keyboard focus and bilingual warning', () => {
  states = []; stateIndex = 0;
  const list = baseList(); list.ids.push('other'); list.byId.other = summary('other');
  list.projectionsBySession = { root: ready([child('shared'),child('shared')]), other: ready([child('shared')]) };
  const calls = [], registrations = [], locale = mockLocale();
  applyPlugin({ locale, slots:{ inject(_name, callback) { callback(); }, register(options, component) { registrations.push({options,component}); } },
    sessions:{ refreshProjections() {}, refresh() {} }, uiWorkspace:{openSession(target) { calls.push(['open',target]); }} });
  const main = registrations.find(item => item.options.name === 'main'), actions = main.options.inject();
  actions.expansion.add('root'); actions.expansion.add('other');
  const props = {...actions,useSessions:selector => selector(list),useSessionStatus:selector => selector(new Map()),useWorkspaces:selector => selector({archivedSessionIds:[]})};
  const flatten = node => node && typeof node === 'object' ? [node,...(node.children ?? []).flat(Infinity).flatMap(flatten)] : [];
  const render = () => { stateIndex = 0; return flatten(main.component(props)); };
  let rows = render().filter(node => node.props?.role === 'treeitem');
  const shared = rows.filter(node => node.props['data-session-id'] === 'shared');
  assert.equal(shared.length,3);
  assert.ok(shared.every(node => node.props['aria-disabled'] === true && node.props['aria-label'].includes('身份存在歧义')));
  assert.ok(shared.every(node => flatten(node).find(child => child.props?.className === 'avatar-select').props.disabled));
  assert.deepEqual(shared.map(node => [node.props['aria-posinset'],node.props['aria-setsize']]),[[1,2],[2,2],[1,1]]);
  assert.equal(new Set(rows.map(node => node.props['data-row-key'])).size,rows.length);
  assert.equal(rows.filter(node => node.props.tabIndex === 0).length,1);
  const elements = rows.map(row => ({dataset:{rowKey:row.props['data-row-key']},focus() { calls.push(['focus',this.dataset.rowKey]); }}));
  states[7].current = { querySelectorAll: () => elements };
  const key = (row, code) => row.props.onKeyDown({key:code,target:1,currentTarget:1,preventDefault(){}});
  key(rows[0],'ArrowDown'); rows = render().filter(node => node.props?.role === 'treeitem');
  assert.equal(calls.at(-1)[1],rows[1].props['data-row-key']);
  assert.equal(rows[1].props.tabIndex,0);
  key(rows[1],'ArrowDown'); rows = render().filter(node => node.props?.role === 'treeitem');
  assert.equal(calls.at(-1)[1],rows[2].props['data-row-key']);
  assert.equal(rows[2].props.tabIndex,0);
  assert.equal(rows.filter(node => node.props.tabIndex === 0).length,1);
  key(rows[2],'Enter'); assert.equal(calls.some(call => call[0] === 'open'),false);
  key(rows[2],'ArrowLeft'); rows = render().filter(node => node.props?.role === 'treeitem');
  assert.equal(calls.at(-1)[1],rows[0].props['data-row-key']);
  assert.equal(rows[0].props.tabIndex,0);
  key(rows[4],'ArrowLeft'); rows = render().filter(node => node.props?.role === 'treeitem');
  assert.equal(calls.at(-1)[1],rows[3].props['data-row-key']);
  assert.equal(rows[3].props.tabIndex,0);
  locale.setLanguage('en'); rows = render().filter(node => node.props?.role === 'treeitem');
  assert.ok(rows.filter(node => node.props['data-session-id'] === 'shared').every(node => node.props['aria-label'].includes('Ambiguous identity')));
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
  applyPlugin(ctx);
  const registration = registrations.find(item => item.options.name === 'main');
  const actions = registration.options.inject();
  for (const id of expansion) actions.expansion.add(id);
  const rootKey = '4:root:0', aKey = `${rootKey}/1:a:0`, bKey = `${aKey}/1:b:0`;
  const elements = [['root',rootKey], ['a',aKey], ['b',bKey]].map(([id,rowKey]) => ({ dataset: { sessionId: id, rowKey }, focus() { calls.push(['focus', id]); } }));
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
  list.projectionsBySession = { root: ready([child('a'), child('b')]), a: ready([child('c'), child('d')]) };
  for (const id of ['a', 'b', 'c', 'd']) list.byId[id] = summary(id, { origin: 'subagent' });
  let registration;
  applyPlugin({ slots: { inject(_name, callback) { callback(); }, register(options, component) { if (options.name === 'main') registration = { options, component }; } }, sessions: {}, uiWorkspace: {} });
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
  applyPlugin({ slots: { inject(_name, callback) { callback(); }, register(options, component) { if (options.name === 'main') registration = { options, component }; } },
    sessions: { refreshProjections(id) { calls.push(['refresh', id]); }, refresh() {} }, uiWorkspace: {} });
  const actions = registration.options.inject();
  const props = { ...actions, useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()), useWorkspaces: selector => selector({ archivedSessionIds: [] }) };
  const rootKey = '4:root:0', aKey = `${rootKey}/1:a:0`;
  const elements = [['root',rootKey], ['a',aKey]].map(([id,rowKey]) => ({ dataset: { sessionId: id, rowKey }, focus() { calls.push(['focus', id]); } }));
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
  execFileSync(process.execPath, [fileURLToPath(new URL('../build.mjs', import.meta.url)), '--check']);
});

test('browser entry only needs React and host bundle is self-contained', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.equal(manifest.name, 'dsh-session-tree');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
  assert.ok(manifest.files.includes('build.mjs'));
  assert.ok(manifest.files.includes('client.template.js'));
  assert.ok(manifest.files.includes('test'));
  assert.match(patch, /name:\s*['"]?dsh-session-tree/);
  for (const entry of ['./index.js', './client.js', './cordis.patch.yml']) await readFile(new URL('../' + entry, import.meta.url));
});

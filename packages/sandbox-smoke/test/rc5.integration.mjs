// Intentionally run only under the installed Electron CLI's Node mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../smoke.mjs';

async function entries(harness) {
  return {
    main: Array.from(harness.ctx.slots.entries('main'), ({ options }) => options.key),
    sidebar: Array.from(harness.ctx.slots.entries('sidebar.panellist'), ({ options }) => options.id),
  };
}

test('real rc.5 host, browser module loader and slot registry activate and clean up', async () => {
  const harness = await createHarness();
  try {
    assert.equal(harness.host.state, 2);
    assert.equal(harness.plugin.state, 2);
    assert.deepEqual(await entries(harness), { main: ['dsh-session-tree'], sidebar: ['dsh-session-tree'] });
    assert.deepEqual(harness.events, ['root', 'main', 'sidebar', 'sidebar', 'sidebar.panellist', 'main', 'sidebar.panellist']);
    const main = harness.ctx.slots.entries('main')[0];
    const sidebar = harness.ctx.slots.entries('sidebar.panellist')[0];
    assert.equal(typeof main.component, 'function');
    assert.equal(typeof sidebar.component, 'function');
    assert.equal(sidebar.options.label, '会话树');
    assert.equal(sidebar.options.order, 55);
    const actions = main.inject();
    await actions.refreshProjection('root');
    await actions.refreshSessions();
    await actions.openSession({ parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' });
    assert.deepEqual(harness.calls, [
      ['refreshProjections', 'root'], ['refresh'],
      ['openSession', { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' }],
    ]);
    await harness.plugin.dispose();
    assert.deepEqual(await entries(harness), { main: [], sidebar: [] });
    assert.equal(harness.ctx.slots.spec('main').kind, 'keyed');
    assert.equal(harness.ctx.slots.spec('sidebar.panellist').kind, 'list');
    const again = await harness.activate();
    assert.equal(again.state, 2);
    assert.deepEqual(await entries(harness), { main: ['dsh-session-tree'], sidebar: ['dsh-session-tree'] });
    await again.dispose();
  } finally {
    await harness.close();
  }
});

test('real session store and subagent catalog projections feed the loaded tree logic', async () => {
  const harness = await createHarness();
  try {
    const { hostCtx, browser } = harness;
    const root = hostCtx.sessions.create('root');
    const child = hostCtx.sessions.create('child', { meta: { parentSession: 'root', origin: 'subagent' } });
    root.append('subagent/catalog', { version: 0, childId: child.id, childCreatedAt: child.header.createdAt, mode: 'continuable', label: '实现子任务' });
    const child2 = hostCtx.sessions.create('grandchild', { meta: { parentSession: 'child', origin: 'subagent' } });
    child.append('subagent/catalog', { version: 0, childId: child2.id, childCreatedAt: child2.header.createdAt, mode: 'one-shot', label: '二级子任务' });
    const list = {
      ids: ['root'],
      byId: { root: { id: root.id, title: '根会话', retainedBy: {} } },
      projectionsBySession: {
        root: { state: 'ready', ...hostCtx.sessionProjections.snapshot(root, ['subagentCatalog']) },
        child: { state: 'ready', ...hostCtx.sessionProjections.snapshot(child, ['subagentCatalog']) },
      },
    };
    const rows = browser.__test.buildRows(list, new Set(['root', 'child']), new Set(), new Map());
    assert.deepEqual(Array.from(rows, (r) => [r.id, r.parentId, r.level, r.title]), [
      ['root', null, 1, '根会话'], ['child', 'root', 2, '实现子任务'], ['grandchild', 'child', 3, '二级子任务'],
    ]);
    const target = browser.__test.navigationTarget(rows[2]);
    assert.deepEqual({ ...target }, { parentSessionId: 'child', childSessionId: 'grandchild', mode: 'one-shot' });
  } finally {
    await harness.close();
  }
});

test('declaring and removing the parent seats attaches and detaches existing contributions', async () => {
  const harness = await createHarness();
  try {
    assert.deepEqual(await entries(harness), { main: ['dsh-session-tree'], sidebar: ['dsh-session-tree'] });
    await harness.declarations.dispose();
    assert.deepEqual(await entries(harness), { main: [], sidebar: [] });
    assert.equal(harness.ctx.slots.spec('main'), undefined);
    const declarations = await harness.declare();
    assert.deepEqual(await entries(harness), { main: ['dsh-session-tree'], sidebar: ['dsh-session-tree'] });
    await declarations.dispose();
  } finally {
    await harness.close();
  }
});

test('closing disposes both browser and host contexts, services and stored sessions', async () => {
  const harness = await createHarness();
  const store = harness.hostCtx.sessions;
  const session = store.create('cleanup-proof');
  assert.equal(store.get(session.id), session);
  assert.ok(harness.hostCtx.subagents);
  assert.ok(harness.ctx.slots);
  await harness.close();
  assert.equal(store.get(session.id), undefined);
  assert.equal(harness.hostCtx.sessions, undefined);
  assert.equal(harness.hostCtx.sessionProjections, undefined);
  assert.equal(harness.hostCtx.subagents, undefined);
  assert.equal(harness.ctx.slots, undefined);
});

test('actual registry rejects duplicate keyed/list entries without replacing them', async () => {
  const harness = await createHarness();
  try {
    assert.throws(() => harness.ctx.slots.register({ name: 'main', key: 'dsh-session-tree' }, () => null), /already has an entry/u);
    assert.throws(() => harness.ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-session-tree' }, () => null), /already has an entry/u);
    assert.deepEqual(await entries(harness), { main: ['dsh-session-tree'], sidebar: ['dsh-session-tree'] });
  } finally {
    await harness.close();
  }
});

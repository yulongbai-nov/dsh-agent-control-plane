// Only synthetic in-memory sessions; run with the installed Electron CLI in Node mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { name, inject, apply } from '../index.js';

const base = 'file:///Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/';
const { Context } = await import(`${base}cordis/lib/index.js`);
const { SessionStore } = await import(`${base}dsh-session/lib/index.js`);
const { SessionProjectionRegistry } = await import(`${base}dsh-session-projection/lib/index.js`);
const { SessionTitleService } = await import(`${base}dsh-session-title/lib/index.js`);

async function environment() {
  const ctx = new Context();
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 });
  return ctx;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function task(lead, subject, revision, status = 'in_progress') {
  const value = { id: 'task-1', revision, subject, description: 'synthetic', status, blockedBy: [], writeScopes: [] };
  if (status === 'in_progress' || status === 'completed') value.ownerId = 'child';
  lead.append('team/task', { version: 2, teamId: lead.id, task: value });
}
function prompt(session, text = 'synthetic input') {
  return session.append('user/message', { id: `synthetic-${session.seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' });
}
function requestHeader(session) {
  session.append('request/header', { header: { config: { provider: 'sample', model: 'sample' } }, reason: 'initial' });
}
function detached(ctx, id, options) {
  const session = ctx.sessions.prepare(id, options);
  const release = ctx.sessions.enter(session);
  ctx.sessions.announce(session);
  return { session, release };
}

test('rc.5 task changes cannot trigger provider on a child with no human input', async () => {
  const ctx = await environment();
  let calls = 0;
  try {
    ctx.sessionTitle.register({ id: 'synthetic', automatic: 'all-prompts', generate() { calls++; return { title: 'not accepted', messageSeqs: [] }; } });
    const lead = ctx.sessions.create('lead');
    const child = ctx.sessions.create('child', { meta: { parentSession: 'lead' } });
    task(lead, 'task A', 1, 'pending');
    task(lead, 'task A', 2);
    requestHeader(child);
    await settle();
    assert.equal(calls, 0);
    assert.equal(ctx.sessionTitle.get(child), undefined);
    assert.equal(await ctx.sessionTitle.refresh(child), undefined);
    assert.equal(calls, 0);
    assert.equal(child.snapshotEvents().filter((event) => event.type === 'session/title').length, 0);
  } finally { await ctx.fiber.dispose(); }
});

test('a task commit cannot synchronously append another event to the same session', async () => {
  const ctx = await environment();
  try {
    await ctx.plugin({ name, inject, apply });
    const lead = ctx.sessions.create('lead');
    const child = ctx.sessions.create('child', { meta: { parentSession: 'lead' } });
    task(lead, 'task A', 1, 'pending');
    task(lead, 'task A', 2);
    prompt(child);
    requestHeader(child);
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, 'task A');
    let error;
    const stop = ctx.on('session/event', (session, event) => {
      if (session !== lead || event.type !== 'team/task' || event.data.task.revision !== 3) return;
      try { lead.append('plugin/probe', { ignored: true }); } catch (caught) { error = caught; }
    });
    task(lead, 'task B', 3);
    stop();
    assert.match(error.message, /cannot reenter/u);
    assert.equal(ctx.sessionTitle.get(child).title, 'task A');
  } finally { await ctx.fiber.dispose(); }
});

test('rc.5 rejects task sequence as title provider message provenance', async () => {
  const ctx = await environment();
  try {
    const session = ctx.sessions.create('synthetic');
    const message = prompt(session);
    await settle();
    const taskEvent = session.append('team/task', { version: 2, teamId: session.id, task: { id: 'task-1', revision: 1, subject: 'task', description: 'synthetic', status: 'pending', blockedBy: [], writeScopes: [] } });
    assert.notEqual(message.seq, taskEvent.seq);
    const before = ctx.sessionTitle.get(session);
    ctx.sessionTitle.register({ id: 'synthetic', automatic: 'all-prompts', generate: () => ({ title: 'task title', messageSeqs: [taskEvent.seq] }) });
    await assert.rejects(ctx.sessionTitle.refresh(session), /messageSeqs/u);
    assert.deepEqual(ctx.sessionTitle.get(session), before);
  } finally { await ctx.fiber.dispose(); }
});

test('rc.5 does not supersede active provider work when Lead task changes', async () => {
  const ctx = await environment();
  let resolve;
  try {
    const pending = Promise.withResolvers(); resolve = pending.resolve;
    let request;
    ctx.sessionTitle.register({ id: 'synthetic', automatic: 'all-prompts', generate(value) { request = value; return pending.promise; } });
    const lead = ctx.sessions.create('lead');
    const child = ctx.sessions.create('child', { meta: { parentSession: 'lead' } });
    task(lead, 'task A', 1, 'pending');
    task(lead, 'task A', 2);
    prompt(child);
    requestHeader(child);
    await settle();
    assert.ok(request);
    task(lead, 'task B', 3);
    assert.equal(request.signal.aborted, false);
    resolve({ title: 'task A', messageSeqs: [request.messages[0].seq] });
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, 'task A');
  } finally { resolve?.({ title: 'cleanup', messageSeqs: [0] }); await ctx.fiber.dispose(); }
});

test('rc.5 automatic provider result can unpin when refresh is used on a pinned session', async () => {
  const ctx = await environment();
  try {
    const child = ctx.sessions.create('child');
    const message = prompt(child);
    await settle();
    ctx.sessionTitle.rename(child, 'manual pin');
    let observed;
    ctx.sessionTitle.register({ id: 'synthetic', automatic: 'all-prompts', generate(value) {
      observed = value.currentTitle.source.kind;
      return { title: 'refresh replacement', messageSeqs: [message.seq] };
    } });
    await ctx.sessionTitle.refresh(child);
    assert.equal(observed, 'user');
    assert.equal(ctx.sessionTitle.get(child).title, 'refresh replacement');
    assert.equal(ctx.sessionTitle.get(child).source.kind, 'provider');
  } finally { await ctx.fiber.dispose(); }
});

test('direct title-event append neither aborts nor protects from in-flight provider', async () => {
  const ctx = await environment();
  let resolve;
  try {
    const pending = Promise.withResolvers(); resolve = pending.resolve;
    let request;
    ctx.sessionTitle.register({ id: 'synthetic', automatic: 'all-prompts', generate(value) { request = value; return pending.promise; } });
    const child = ctx.sessions.create('child');
    prompt(child);
    requestHeader(child);
    await settle();
    child.append('session/title', { title: 'manual pin bypass', messageSeqs: [], source: { kind: 'user' } });
    assert.equal(ctx.sessionTitle.get(child).source.kind, 'user');
    assert.equal(request.signal.aborted, false);
    resolve({ title: 'late provider', messageSeqs: [request.messages[0].seq] });
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, 'late provider');
    assert.equal(ctx.sessionTitle.get(child).source.kind, 'provider');
  } finally { resolve?.({ title: 'cleanup', messageSeqs: [0] }); await ctx.fiber.dispose(); }
});

test('restored cold child keeps old title after task update until another eligible message', async () => {
  const ctx = await environment();
  try {
    await ctx.plugin({ name, inject, apply });
    const lead = ctx.sessions.create('lead');
    const first = detached(ctx, 'child', { meta: { parentSession: 'lead' } });
    task(lead, 'task A', 1, 'pending');
    task(lead, 'task A', 2);
    prompt(first.session);
    requestHeader(first.session);
    await settle();
    assert.equal(ctx.sessionTitle.get(first.session).title, 'task A');
    const seed = first.session.snapshotEvents();
    first.release();
    task(lead, 'task B while cold', 3);
    const resumed = detached(ctx, 'child', { seed, eventState: 'shared-frozen', inheritedEventCount: 0, meta: first.session.header });
    await settle();
    assert.equal(ctx.sessionTitle.get(resumed.session).title, 'task A');
    assert.deepEqual(resumed.session.snapshotEvents().slice(seed.length).map((event) => event.type), ['session/end-seed']);
    prompt(resumed.session, 'next human input');
    requestHeader(resumed.session);
    await settle();
    assert.equal(ctx.sessionTitle.get(resumed.session).title, 'task B while cold');
    resumed.release();
  } finally { await ctx.fiber.dispose(); }
});

test('resumed seeded pinned title survives task event; no cold trigger is replayed', async () => {
  const ctx = await environment();
  try {
    await ctx.plugin({ name, inject, apply });
    const lead = ctx.sessions.create('lead');
    const first = detached(ctx, 'child', { meta: { parentSession: 'lead' } });
    task(lead, 'first task', 1, 'pending');
    task(lead, 'first task', 2);
    prompt(first.session);
    requestHeader(first.session);
    await settle();
    ctx.sessionTitle.rename(first.session, 'pinned');
    const seed = first.session.snapshotEvents();
    first.release();
    assert.equal(ctx.sessions.get('child'), undefined);
    task(lead, 'changed while cold', 3);
    const resumed = detached(ctx, 'child', { seed, eventState: 'shared-frozen', inheritedEventCount: 0, meta: first.session.header });
    await settle();
    assert.equal(ctx.sessionTitle.get(resumed.session).title, 'pinned');
    assert.equal(ctx.sessionTitle.get(resumed.session).source.kind, 'user');
    assert.deepEqual(resumed.session.snapshotEvents().slice(seed.length).map((event) => event.type), ['session/end-seed']);
    task(lead, 'changed after resume', 4);
    await settle();
    assert.equal(ctx.sessionTitle.get(resumed.session).title, 'pinned');
    resumed.release();
  } finally { await ctx.fiber.dispose(); }
});

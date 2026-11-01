// Run with ELECTRON_RUN_AS_NODE=1 and the installed rc.5 Electron executable.
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
function appendTask(lead, subject, revision, status) {
  const task = { id: 'task-1', revision, subject, description: 'description', status, blockedBy: [], writeScopes: [] };
  if (status === 'in_progress' || status === 'completed') task.ownerId = 'child';
  lead.append('team/task', { version: 2, teamId: lead.id, task });
}
function appendPrompt(session, text) {
  session.append('user/message', { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' });
}
function startRequest(session) {
  session.append('request/header', { header: { config: { provider: 'sample', model: 'sample' } }, reason: 'initial' });
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('rc.5 registers, automatically schedules after a human message and route, and pins title', async () => {
  const ctx = await environment();
  try {
    const plugin = { name, inject, apply };
    await ctx.plugin(plugin);
    const lead = ctx.sessions.create('lead');
    const child = ctx.sessions.create('child', { meta: { parentSession: 'lead' } });
    appendTask(lead, '实现标题', 1, 'pending');
    appendTask(lead, '实现标题', 2, 'in_progress');
    appendPrompt(child, '请实现');
    startRequest(child);
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, '实现标题');
    assert.equal(ctx.sessionTitle.get(child).source.kind, 'provider');
    assert.deepEqual(ctx.sessionTitle.get(child).messageSeqs, [0]);

    appendTask(lead, '任务更新', 3, 'in_progress');
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, '实现标题');

    appendPrompt(child, '继续');
    startRequest(child);
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, '任务更新');

    ctx.sessionTitle.rename(child, '手动固定');
    appendPrompt(child, '接着做');
    startRequest(child);
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, '手动固定');
    await assert.rejects(ctx.sessionTitle.refresh(child), /pinned/u);
    assert.equal(ctx.sessionTitle.get(child).source.kind, 'user');
    assert.equal(ctx.sessionTitle.get(child).title, '手动固定');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('rc.5 keeps the current fallback on an automatic provider failure', async () => {
  const ctx = await environment();
  try {
    await ctx.plugin({ name, inject, apply });
    ctx.sessions.create('lead');
    const child = ctx.sessions.create('child', { meta: { parentSession: 'lead' } });
    appendPrompt(child, '没有分配任务');
    startRequest(child);
    await settle();
    assert.equal(ctx.sessionTitle.get(child).source.kind, 'fallback');
    assert.equal(ctx.sessionTitle.get(child).title, '没有分配任务');
    assert.equal(child.snapshotEvents().filter((event) => event.type === 'session/title').length, 1);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('rc.5 keeps an accepted provider title when a later task is released', async () => {
  const ctx = await environment();
  try {
    await ctx.plugin({ name, inject, apply });
    const lead = ctx.sessions.create('lead');
    const child = ctx.sessions.create('child', { meta: { parentSession: 'lead' } });
    appendTask(lead, '原任务', 1, 'pending');
    appendTask(lead, '原任务', 2, 'in_progress');
    appendPrompt(child, '开始');
    startRequest(child);
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, '原任务');
    const eventCount = child.snapshotEvents().filter(event => event.type === 'session/title').length;
    appendTask(lead, '原任务', 3, 'pending');
    appendPrompt(child, '继续');
    startRequest(child);
    await settle();
    assert.equal(ctx.sessionTitle.get(child).title, '原任务');
    assert.equal(child.snapshotEvents().filter(event => event.type === 'session/title').length, eventCount);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('rc.5 refresh without a provider explicitly unpins a user title', async () => {
  const ctx = await environment();
  try {
    const session = ctx.sessions.create('standalone');
    appendPrompt(session, '回退标题');
    await settle();
    ctx.sessionTitle.rename(session, '手动固定');
    await ctx.sessionTitle.refresh(session);
    assert.equal(ctx.sessionTitle.get(session).source.kind, 'fallback');
    assert.equal(ctx.sessionTitle.get(session).title, '回退标题');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('rc.5 ignores stale generation that finishes after a newer message', async () => {
  const ctx = await environment();
  try {
    const pending = [];
    ctx.sessionTitle.register({
      id: 'race-test', automatic: 'all-prompts',
      generate(request) {
        const { promise, resolve } = Promise.withResolvers();
        pending.push({ request, resolve });
        return promise;
      },
    });
    const session = ctx.sessions.create('race');
    appendPrompt(session, '第一个');
    startRequest(session);
    await settle();
    assert.equal(pending.length, 1);
    appendPrompt(session, '第二个');
    startRequest(session);
    await settle();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].request.signal.aborted, true);
    pending[1].resolve({ title: '新标题', messageSeqs: [pending[1].request.messages.at(-1).seq] });
    await settle();
    pending[0].resolve({ title: '过时标题', messageSeqs: [pending[0].request.messages.at(-1).seq] });
    await settle();
    assert.equal(ctx.sessionTitle.get(session).title, '新标题');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('rc.5 cannot commit a pending generation after manual rename', async () => {
  const ctx = await environment();
  try {
    const { promise, resolve } = Promise.withResolvers();
    let request;
    ctx.sessionTitle.register({ id: 'race-test', automatic: 'all-prompts', generate(value) { request = value; return promise; } });
    const session = ctx.sessions.create('race');
    appendPrompt(session, '一个任务');
    startRequest(session);
    await settle();
    assert.ok(request);
    ctx.sessionTitle.rename(session, '手动标题');
    assert.equal(request.signal.aborted, true);
    resolve({ title: '过时标题', messageSeqs: [request.messages[0].seq] });
    await settle();
    assert.equal(ctx.sessionTitle.get(session).title, '手动标题');
    assert.equal(ctx.sessionTitle.get(session).source.kind, 'user');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('rc.5 rejects second provider registration rather than replacing the first', async () => {
  const ctx = await environment();
  try {
    await ctx.plugin({ name, inject, apply });
    assert.throws(() => ctx.sessionTitle.register({ id: 'another', automatic: 'all-prompts', generate() {} }), /already registered/u);
  } finally {
    await ctx.fiber.dispose();
  }
});

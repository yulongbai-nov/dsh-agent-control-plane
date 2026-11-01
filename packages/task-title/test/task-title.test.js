import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, createProvider, inject, name } from '../index.js';

function event(seq, id, subject, status = 'in_progress', ownerId = 'child', revision = 1) {
  const task = { id, subject, status, revision, description: 'description', blockedBy: [], writeScopes: [] };
  if (ownerId !== null) task.ownerId = ownerId;
  return { seq, type: 'team/task', data: { version: 2, teamId: 'lead', task } };
}
function setup(events = [], { parent = true } = {}) {
  const lead = { id: 'lead', snapshotEvents: () => events };
  const session = { id: parent ? 'child' : 'lead', header: parent ? { parentSession: 'lead' } : {} };
  const sessions = { get: (id) => id === 'lead' ? lead : undefined };
  const request = { session, messages: [{ seq: 3, text: '开始任务' }], signal: new AbortController().signal };
  return { sessions, request };
}

test('Cordis plugin injects title and sessions, registering the rc.5 cadence', () => {
  let registered;
  const sessions = {};
  const dispose = () => {};
  const ctx = { sessions, sessionTitle: { register(provider) { registered = provider; return dispose; } } };
  assert.equal(name, 'task-title');
  assert.deepEqual(inject, ['sessionTitle', 'sessions']);
  assert.equal(apply(ctx), dispose);
  assert.equal(registered.id, name);
  assert.equal(registered.automatic, 'all-prompts');
});

test('folds rc.5 pending, claim and completion snapshots by session ID, not member name', async () => {
  const events = [
    { seq: 11, type: 'team/task', data: { version: 2, teamId: 'lead', task: { id: 'task-1', revision: 1, subject: '真实形状', description: '范围', status: 'pending', blockedBy: [], writeScopes: ['packages/task-title'] } } },
    { seq: 12, type: 'team/task', data: { version: 2, teamId: 'lead', task: { id: 'task-1', revision: 2, subject: '真实形状', description: '范围', status: 'in_progress', ownerId: 'child', blockedBy: [], writeScopes: ['packages/task-title'] } } },
    { seq: 13, type: 'team/task', data: { version: 2, teamId: 'lead', task: { id: 'task-1', revision: 3, subject: '真实形状', description: '范围', status: 'completed', ownerId: 'child', blockedBy: [], writeScopes: ['packages/task-title'] } } },
    { seq: 14, type: 'team/task', data: { version: 2, teamId: 'lead', task: { id: 'task-2', revision: 1, subject: '名字不是 ID', description: '范围', status: 'pending', blockedBy: [], writeScopes: [] } } },
    { seq: 15, type: 'team/task', data: { version: 2, teamId: 'lead', task: { id: 'task-2', revision: 2, subject: '名字不是 ID', description: '范围', status: 'in_progress', ownerId: 'task-title', blockedBy: [], writeScopes: [] } } },
  ];
  const { sessions, request } = setup(events);
  assert.deepEqual(await createProvider(sessions).generate(request), { title: '真实形状', messageSeqs: [3] });
});

test('uses most recently active assigned task with a valid rc.5 message sequence', async () => {
  const events = [event(1, 'task-1', '旧任务'), event(2, 'task-2', '  新任务  '), event(3, 'task-3', '别人的任务', 'in_progress', 'other')];
  const { sessions, request } = setup(events);
  assert.deepEqual(await createProvider(sessions).generate(request), { title: '新任务', messageSeqs: [3] });
});

test('retains last completed task when idle and ignores edits after completion', async () => {
  const events = [event(1, 'task-1', '旧任务'), event(2, 'task-1', '旧任务', 'completed', 'child', 2), event(3, 'task-2', '新任务'), event(4, 'task-2', '新任务', 'completed', 'child', 2), event(5, 'task-1', '旧任务', 'completed', 'child', 3)];
  const { sessions, request } = setup(events);
  assert.deepEqual(await createProvider(sessions).generate(request), { title: '新任务', messageSeqs: [3] });
});

test('prefers active work over a later edit or completion of another task', async () => {
  const events = [event(1, 'task-1', '空闲旧任务'), event(2, 'task-2', '当前任务'), event(3, 'task-1', '空闲旧任务', 'completed', 'child', 2)];
  const { sessions, request } = setup(events);
  assert.equal((await createProvider(sessions).generate(request)).title, '当前任务');
});

test('rc.5 claim, release, then reassignment to another session clears the prior owner', async () => {
  const events = [
    event(1, 'task-1', '转交任务', 'pending', null, 1),
    event(2, 'task-1', '转交任务', 'in_progress', 'child', 2),
    event(3, 'task-1', '转交任务', 'pending', null, 3),
    event(4, 'task-1', '转交任务', 'in_progress', 'different-session-id', 4),
  ];
  const { sessions, request } = setup(events);
  await assert.rejects(createProvider(sessions).generate(request), /no eligible task/u);
});

test('release, reassignment, deletion and inherited foreign team events do not become tasks', async () => {
  const events = [
    event(1, 'task-1', '已释放'), event(2, 'task-1', '已释放', 'pending', null, 2),
    event(3, 'task-2', '已转交'), event(4, 'task-2', '已转交', 'in_progress', 'other', 2),
    event(5, 'task-3', '已删除'), event(6, 'task-3', '已删除', 'deleted', 'child', 2),
    { ...event(7, 'task-4', '别的团队'), data: { ...event(7, 'task-4', '别的团队').data, teamId: 'other-lead' } },
  ];
  const { sessions, request } = setup(events);
  await assert.rejects(createProvider(sessions).generate(request), /no eligible task/u);
});

test('without a valid task the provider fails rather than replacing an existing title', async () => {
  const { sessions, request } = setup([event(1, 'task-1', '   ')]);
  request.currentTitle = { title: '原有标题', source: { kind: 'provider' } };
  await assert.rejects(createProvider(sessions).generate(request), /no eligible task/u);
});

test('explicit refresh of a pinned title is rejected even if the task is present', async () => {
  const { sessions, request } = setup([event(1, 'task-1', '任务')]);
  request.currentTitle = { title: '手动标题', source: { kind: 'user' } };
  await assert.rejects(createProvider(sessions).generate(request), /pinned/u);
});

test('requires a supplied human message and cannot synthesize task-event provenance', async () => {
  const { sessions, request } = setup([event(1, 'task-1', '任务')]);
  request.messages = [];
  await assert.rejects(createProvider(sessions).generate(request), /human message/u);
});

test('observes cancellation and never modifies a session', async () => {
  const { sessions, request } = setup([event(1, 'task-1', '任务')]);
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  request.signal = controller.signal;
  await assert.rejects(createProvider(sessions).generate(request), /cancelled/u);
});

test('a root session or unavailable lead fails closed', async () => {
  const a = setup([], { parent: false });
  await assert.rejects(createProvider(a.sessions).generate(a.request), /no eligible task/u);
  const b = setup();
  await assert.rejects(createProvider({ get: () => undefined }).generate(b.request), /no eligible task/u);
});

test('fails closed on noncontiguous task revisions or a missing initial snapshot', async () => {
  for (const events of [
    [event(1, 'task-1', '当前任务', 'in_progress', 'child', 2)],
    [event(1, 'task-1', '当前任务'), event(2, 'task-1', '不应回滚', 'completed', 'child', 1)],
    [event(1, 'task-1', '当前任务'), event(2, 'task-1', '缺失的修订', 'in_progress', 'child', 3)],
  ]) {
    const { sessions, request } = setup(events);
    await assert.rejects(createProvider(sessions).generate(request), /invalid team task/u);
  }
});

test('selects the most recently started active task, not an edit of older work', async () => {
  const events = [event(1, 'task-1', '原任务'), event(2, 'task-2', '新任务'), event(3, 'task-1', '原任务改名', 'in_progress', 'child', 2)];
  const { sessions, request } = setup(events);
  assert.equal((await createProvider(sessions).generate(request)).title, '新任务');
});

test('an owner change during an active task starts a new assignment', async () => {
  const events = [event(1, 'task-1', '后分配', 'in_progress', 'other'), event(2, 'task-2', '先分配'), event(3, 'task-1', '后分配', 'in_progress', 'child', 2)];
  const { sessions, request } = setup(events);
  assert.equal((await createProvider(sessions).generate(request)).title, '后分配');
});

test('an unsupported or malformed event for this team fails closed', async () => {
  for (const invalid of [
    { seq: 2, type: 'team/task', data: { version: 99, teamId: 'lead' } },
    { seq: 2, type: 'team/task', data: { version: 2, teamId: 'lead', task: { id: 'task-1' } } },
  ]) {
    const { sessions, request } = setup([event(1, 'task-1', '任务'), invalid]);
    await assert.rejects(createProvider(sessions).generate(request), /invalid team task/u);
  }
});

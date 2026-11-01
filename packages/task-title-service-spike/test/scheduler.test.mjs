import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, createSyntheticHost } from '../index.mjs';

const ready = (host, { authorize = true } = {}) => {
  if (authorize) host.setAuthorized(true);
  const lead = host.createLead('lead');
  const child = host.createChild('child', lead);
  host.task(lead, { id: 'task', revision: 1, status: 'pending', subject: 'Task A' });
  host.task(lead, { id: 'task', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'Task A' });
  return { lead, child };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => Promise.withResolvers();

test('eligible task starts without fabricated message and commits only synthetic state', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const model = createModel(host); model.observe(lead); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'task', title: 'Task A', taskId: 'task', revision: 2 });
  assert.deepEqual(host.events(child), []);
});

test('manual pin supersedes pending task and is never overwritten', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let signal;
  const model = createModel(host, { generate: async (input) => { signal = input.signal; await gate.promise; return input.subject; } });
  model.observe(lead); await settle();
  model.rename(child, 'Pinned');
  assert.equal(signal.aborted, true);
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'user', title: 'Pinned' });
});

test('synthetic callers cannot mutate host task, title or event internals', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const model = createModel(host); model.observe(lead); await model.idle();
  const title = host.title(child); title.title = 'forged';
  assert.equal(host.title(child).title, 'Task A');
  assert.deepEqual(Object.keys(lead), []);
  assert.deepEqual(Object.keys(child), []);
  assert.throws(() => { child.title = { kind: 'user', title: 'forged' }; }, TypeError);
  assert.throws(() => { lead.high = 0; }, TypeError);
});

test('rapid revision changes cancel stale work and coalesce before generation', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), calls = [];
  const model = createModel(host, { generate: async (input) => { calls.push(input); if (input.revision === 2) await gate.promise; return input.subject; } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'Task B' }); model.observe(lead);
  host.task(lead, { id: 'task', revision: 4, ownerId: 'child', status: 'in_progress', subject: 'Task C' }); model.observe(lead);
  assert.equal(calls[0].signal.aborted, true);
  gate.resolve(); await model.idle();
  assert.deepEqual(calls.map((x) => x.revision), [2, 4]);
  assert.equal(host.title(child).title, 'Task C');
});

test('lagging observations fail closed rather than trusting old task', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const model = createModel(host);
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'Task B' });
  model.observe(lead, 2); await model.idle();
  assert.equal(host.title(child), undefined);
});

test('retry after unrelated task advances authoritative high during generation', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { if (++calls === 1) await gate.promise; return subject; } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'unrelated', revision: 1, status: 'pending', subject: 'Other' });
  gate.resolve(); await model.idle(); assert.equal(host.title(child), undefined);
  model.observe(lead); await model.idle();
  assert.equal(calls, 2); assert.equal(host.title(child)?.title, 'Task A');
});

test('retry after an incomplete observation invalidates pending work', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { if (++calls === 1) await gate.promise; return subject; } });
  model.observe(lead); await settle(); model.observe(lead, 1);
  gate.resolve(); await model.idle(); assert.equal(host.title(child), undefined);
  model.observe(lead); await model.idle();
  assert.equal(calls, 2); assert.equal(host.title(child)?.title, 'Task A');
});

test('retry after authorization revocation and regrant invalidates old generation', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { if (++calls === 1) await gate.promise; return subject; } });
  model.observe(lead); await settle(); host.setAuthorized(false); host.setAuthorized(true);
  gate.resolve(); await model.idle(); assert.equal(host.title(child), undefined);
  model.observe(lead); await model.idle();
  assert.equal(calls, 2); assert.equal(host.title(child)?.title, 'Task A');
});

test('a failed generator retries only on an explicit subsequent observation', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { if (++calls === 1) throw new Error('synthetic'); return subject; } });
  model.observe(lead); await model.idle(); await settle();
  assert.equal(calls, 1); assert.equal(host.title(child), undefined);
  model.observe(lead); await model.idle();
  assert.equal(calls, 2); assert.equal(host.title(child)?.title, 'Task A');
});

test('a task cut already invalid at observe time may retry without canceling newer message', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let messageSignal, calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.observe(lead);
  host.task(lead, { id: 'unrelated', revision: 1, status: 'pending', subject: 'Other' });
  await model.idle(); assert.equal(calls, 0);
  model.message(child, async ({ signal }) => { messageSignal = signal; await gate.promise; return 'Latest message'; });
  await settle(); model.observe(lead); await settle();
  assert.equal(messageSignal.aborted, false); assert.equal(calls, 0);
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'message', title: 'Latest message' });
});

test('same-task retry never overwrites a newer pending or completed message', async () => {
  for (const stage of ['pending', 'completed']) {
    const host = createSyntheticHost(); const { lead, child } = ready(host);
    const taskGate = deferred(), messageGate = deferred(); let taskCalls = 0, messageSignal;
    const model = createModel(host, { generate: async ({ subject }) => { taskCalls++; await taskGate.promise; return subject; } });
    model.observe(lead); await settle();
    model.message(child, async ({ signal }) => { messageSignal = signal; await messageGate.promise; return 'Latest conversation'; });
    await settle();
    if (stage === 'completed') { messageGate.resolve(); await settle(); }
    model.observe(lead); await settle();
    assert.equal(messageSignal.aborted, false, stage);
    assert.equal(taskCalls, 1, stage);
    messageGate.resolve(); taskGate.resolve(); await model.idle();
    assert.deepEqual(host.title(child), { kind: 'message', title: 'Latest conversation' }, stage);
  }
});

test('same-task retry never overwrites a newer pin', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; await gate.promise; return subject; } });
  model.observe(lead); await settle(); model.rename(child, 'Pinned');
  model.observe(lead); await settle(); assert.equal(calls, 1);
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'user', title: 'Pinned' });
});

test('same-task retry cannot restore an old owner after reassignment', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; await gate.promise; return subject; } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'other', status: 'in_progress', subject: 'Task A' });
  model.observe(lead); model.observe(lead); await settle(); assert.equal(calls, 1);
  gate.resolve(); await model.idle(); assert.equal(host.title(child), undefined);
});

test('removing the old task cannot cancel newer message work', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const taskGate = deferred(), msgGate = deferred(); let signal;
  const model = createModel(host, { generate: async ({ subject }) => { await taskGate.promise; return subject; } });
  model.observe(lead); await settle();
  model.message(child, async (value) => { signal = value.signal; await msgGate.promise; return 'New message'; });
  await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'other', status: 'in_progress', subject: 'Task A' });
  model.observe(lead); assert.equal(signal.aborted, false);
  msgGate.resolve(); taskGate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'message', title: 'New message' });
});

test('a different relevant task cannot revive the old candidate over a newer message', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; await gate.promise; return subject; } });
  model.observe(lead); await settle();
  model.message(child, async () => 'Latest message'); await settle();
  host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'Other' });
  host.task(lead, { id: 'other', revision: 2, ownerId: 'child', status: 'completed', subject: 'Other' });
  model.observe(lead); await settle(); assert.equal(calls, 1);
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'message', title: 'Latest message' });
});

test('ambiguous task observation cannot clear the newer message arbitration fence', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; await gate.promise; return subject; } });
  model.observe(lead); await settle();
  model.message(child, async () => 'Newer message'); await settle();
  host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'Other' });
  host.task(lead, { id: 'other', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'Other' });
  model.observe(lead);
  host.task(lead, { id: 'other', revision: 3, status: 'pending', subject: 'Other' });
  model.observe(lead); await settle(); assert.equal(calls, 1);
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'message', title: 'Newer message' });
});

test('a task first observed only after a newer message does not trump it', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const model = createModel(host); model.message(child, async () => 'New message'); await model.idle();
  model.observe(lead); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'message', title: 'New message' });
});

test('same-task retry cannot cross an owner away-and-back transition', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject, revision }) => { calls++; if (revision === 2) await gate.promise; return `${subject} rev-${revision}`; } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'other', status: 'in_progress', subject: 'Task B' });
  host.task(lead, { id: 'task', revision: 4, ownerId: 'child', status: 'in_progress', subject: 'Task C' });
  model.observe(lead); await settle(); gate.resolve(); await model.idle();
  assert.equal(calls, 2);
  assert.deepEqual(host.title(child), { kind: 'task', title: 'Task C rev-4', taskId: 'task', revision: 4 });
});

test('a later observe with a new cut retries in-flight work invalidated by unrelated task changes', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); const calls = [];
  const model = createModel(host, { generate: async (input) => { calls.push(input); if (calls.length === 1) await gate.promise; return input.subject; } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'Other' });
  model.observe(lead); assert.equal(calls[0].signal.aborted, true);
  await settle(); gate.resolve(); await model.idle();
  assert.equal(calls.length, 2);
  assert.equal(host.title(child)?.title, 'Task A');
});

test('successful and pending task work coalesces repeated observations', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; await gate.promise; return subject; } });
  model.observe(lead); await settle(); model.observe(lead); await settle(); assert.equal(calls, 1);
  gate.resolve(); await model.idle(); model.observe(lead); await model.idle();
  assert.equal(calls, 1); assert.equal(host.title(child)?.title, 'Task A');
});

test('persistent failure waits for each explicit observe without a tight loop', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async () => { calls++; throw new Error('failure'); } });
  model.observe(lead); await model.idle(); await settle(); assert.equal(calls, 1);
  model.observe(lead); await model.idle(); await settle(); assert.equal(calls, 2);
  assert.equal(host.title(child), undefined);
});

test('service closing blocks replacement until pending work quiesces', async () => {
  const host = createSyntheticHost(); const { lead } = ready(host);
  const gate = deferred(); const first = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
  first.observe(lead); await settle();
  const closing = first.dispose();
  assert.throws(() => createModel(host), /already owned/);
  gate.resolve(); await closing;
  assert.doesNotThrow(() => createModel(host));
});

test('late observation after user pin preserves the pin', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const model = createModel(host); model.rename(child, 'Pinned');
  model.observe(lead); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'user', title: 'Pinned' });
});

test('lead replacement with the same identity cannot publish an old result', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); const model = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
  model.observe(lead); await settle(); host.disposeLead(lead);
  const replacement = host.createLead('lead');
  gate.resolve(); await model.idle();
  assert.equal(host.title(child), undefined);
  model.observe(replacement); await model.idle();
  assert.equal(host.title(child), undefined);
});

test('owner reassignment and release cannot write to the old child', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); const model = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'other', status: 'in_progress', subject: 'Task A' }); model.observe(lead);
  gate.resolve(); await model.idle();
  assert.equal(host.title(child), undefined);
});

test('malformed and non-data task snapshots fail closed without executing getters', async () => {
  for (const mode of ['getter', 'symbol', 'extra', 'array', 'prototype']) {
    const host = createSyntheticHost(); const { lead, child } = ready(host);
    const gate = deferred(); const model = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
    model.observe(lead); await settle();
    let calls = 0;
    const task = { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'B' };
    let input = task;
    if (mode === 'getter') Object.defineProperty(task, 'revision', { get() { calls++; return 3; }, enumerable: true });
    if (mode === 'symbol') task[Symbol('x')] = 1;
    if (mode === 'extra') task.secret = 'unknown';
    if (mode === 'array') input = [];
    if (mode === 'prototype') input = Object.assign(Object.create({ inherited: true }), task);
    host.task(lead, input); model.observe(lead); gate.resolve(); await model.idle();
    assert.equal(host.title(child), undefined, mode);
    assert.equal(calls, 0, mode);
  }
});

test('release, deletion, missing revision and multiple owners are fail closed', async () => {
  for (const mode of ['release', 'delete', 'gap', 'ambiguous']) {
    const host = createSyntheticHost(); const { lead, child } = ready(host);
    const gate = deferred(); const model = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
    model.observe(lead); await settle();
    if (mode === 'release') host.task(lead, { id: 'task', revision: 3, status: 'pending', subject: 'Task A' });
    if (mode === 'delete') host.task(lead, { id: 'task', revision: 3, status: 'deleted', subject: 'Task A' });
    if (mode === 'gap') host.task(lead, { id: 'task', revision: 4, ownerId: 'child', status: 'in_progress', subject: 'Task C' });
    if (mode === 'ambiguous') {
      host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'Task B' });
      host.task(lead, { id: 'other', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'Task B' });
    }
    model.observe(lead); gate.resolve(); await model.idle();
    assert.equal(host.title(child), undefined, mode);
  }
});

test('old task revision replay after reassignment poisons observation and cannot reauthorize old owner', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const model = createModel(host); model.observe(lead); await model.idle();
  assert.equal(host.title(child).title, 'Task A');
  host.task(lead, { id: 'task', revision: 3, ownerId: 'other', status: 'in_progress', subject: 'B' });
  model.observe(lead); await model.idle();
  host.task(lead, { id: 'task', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'Old replay' });
  model.observe(lead); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'task', title: 'Task A', taskId: 'task', revision: 2 });
  host.task(lead, { id: 'task', revision: 4, ownerId: 'child', status: 'in_progress', subject: 'New claim' });
  model.observe(lead); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'task', title: 'Task A', taskId: 'task', revision: 2 });
});

test('cooperative child cancellation allows pending service disposal to drain', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  let observedAbort = false;
  const model = createModel(host, { generate: ({ signal }) => new Promise((resolve) => {
    const stop = () => { observedAbort = true; resolve('cancelled'); };
    if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
  }) });
  model.observe(lead); await settle();
  host.disposeChild(child); model.invalidate(child);
  await model.dispose();
  assert.equal(observedAbort, true);
  assert.equal(host.title(child), undefined);
  assert.doesNotThrow(() => createModel(host));
});

test('if the authoritative task changes without notification, precommit checks reject old output', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); const model = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'Task B' });
  gate.resolve(); await model.idle();
  assert.equal(host.title(child), undefined);
});

test('genuinely later task update and message share one generation revision', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let signal;
  const model = createModel(host);
  model.message(child, async (value) => { signal = value.signal; await gate.promise; return 'Message title'; });
  await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'Later task' });
  model.observe(lead); assert.equal(signal.aborted, true);
  gate.resolve(); await model.idle();
  assert.equal(host.title(child).title, 'Later task');
});

test('an unrelated task event must not cancel pending message work', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let signal;
  const model = createModel(host);
  model.observe(lead); await model.idle();
  model.message(child, async (input) => { signal = input.signal; await gate.promise; return 'Valid message'; });
  await settle();
  host.task(lead, { id: 'unrelated', revision: 1, status: 'pending', subject: 'Other task' });
  model.observe(lead);
  assert.equal(signal.aborted, false);
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'message', title: 'Valid message' });
});

test('stale task observation cannot cancel pending message work', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let signal;
  const model = createModel(host);
  model.message(child, async (input) => { signal = input.signal; await gate.promise; return 'Valid message'; });
  await settle(); model.observe(lead, 1);
  assert.equal(signal.aborted, false);
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'message', title: 'Valid message' });
});

test('later synthetic user work supersedes old task generation', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let signal;
  const model = createModel(host, { generate: async (input) => { signal = input.signal; await gate.promise; return input.subject; } });
  model.observe(lead); await settle();
  model.message(child, async () => 'Latest conversation'); assert.equal(signal.aborted, true);
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'message', title: 'Latest conversation' });
});

test('a bare old message result cannot overwrite a pin', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), model = createModel(host);
  model.message(child, async () => { await gate.promise; return 'Stale message'; });
  await settle(); model.rename(child, 'Pinned');
  gate.resolve(); await model.idle(); assert.deepEqual(host.title(child), { kind: 'user', title: 'Pinned' });
});

test('unknown authorization invalidates existing work even if later granted', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), model = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
  model.observe(lead); await settle(); host.setAuthorized(false); host.setAuthorized(true);
  gate.resolve(); await model.idle(); assert.equal(host.title(child), undefined);
});

test('dispose/recreate with same identity cannot accept late work for old session', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); const model = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
  model.observe(lead); await settle();
  host.disposeChild(child); const replacement = host.createChild('child', lead);
  model.invalidate(child); gate.resolve(); await model.idle();
  assert.equal(host.title(child), undefined); assert.equal(host.title(replacement), undefined);
});

test('freshly attached session does not automatically replay a cold task update', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const model = createModel(host); host.disposeChild(child);
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'Cold change' });
  model.observe(lead); await model.idle();
  const replacement = host.createChild('child', lead); await model.idle();
  assert.equal(host.title(replacement), undefined);
  model.observe(lead); await model.idle();
  assert.deepEqual(host.title(replacement), { kind: 'task', title: 'Cold change', taskId: 'task', revision: 3 });
});

test('authorization and cold status are unknown by default', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host, { authorize: false });
  const model = createModel(host); model.observe(lead); await model.idle();
  assert.equal(host.title(child), undefined);
  host.setAuthorized(true); host.disposeChild(child);
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'cold task' });
  model.observe(lead); await model.idle();
  assert.equal(host.title(child), undefined);
});

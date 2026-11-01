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

test('abort listener cannot reenter invalidate while old work is being superseded', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), reentrant = [], calls = [];
  let model;
  model = createModel(host, { generate: async (input) => {
    calls.push(input);
    input.signal.addEventListener('abort', () => {
      host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'B' });
      host.task(lead, { id: 'other', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'B' });
      reentrant.push(model.observe(lead));
      host.task(lead, { id: 'other', revision: 3, ownerId: 'child', status: 'completed', subject: 'B' });
      reentrant.push(model.observe(lead));
    }, { once: true });
    await gate.promise; return input.subject;
  } });
  model.observe(lead); await settle(); model.invalidate(child);
  gate.resolve(); await model.idle();
  assert.equal(host.title(child), undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual(reentrant, [{ status: 'reentrant' }, { status: 'reentrant' }]);
});

test('abort callback receives a nonthrowing reentrant result from every synchronous model entry point', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), reentrant = []; let model;
  model = createModel(host, { generate: async ({ signal, subject }) => {
    signal.addEventListener('abort', () => {
      for (const operation of [
        () => model.observe(lead), () => model.message(child, async () => 'bad'),
        () => model.rename(child, 'bad'), () => model.invalidate(child), () => model.idle(), () => model.dispose(),
      ]) {
        reentrant.push(operation());
      }
    }, { once: true });
    await gate.promise; return subject;
  } });
  model.observe(lead); await settle(); model.rename(child, 'Pinned');
  assert.deepEqual(reentrant, Array.from({ length: 6 }, () => ({ status: 'reentrant' })));
  assert.equal(typeof reentrant[4].then, 'undefined'); assert.equal(typeof reentrant[5].then, 'undefined');
  assert.ok(Object.isFrozen(reentrant[0]));
  gate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'user', title: 'Pinned' });
});

test('reentrant calls from invalidation abort leave fence installed and later new tasks work', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), seen = []; let model;
  model = createModel(host, { generate: async ({ signal, revision, subject }) => {
    if (revision === 2) {
      signal.addEventListener('abort', () => {
        seen.push(host.title(child));
        seen.push(model.observe(lead));
        seen.push(model.rename(child, 'forged'));
        seen.push(model.message(child, async () => 'forged'));
        seen.push(model.invalidate(child));
        seen.push(model.dispose());
      }, { once: true });
      await gate.promise;
    }
    return subject;
  } });
  model.observe(lead); await settle(); model.invalidate(child);
  assert.equal(seen[0], undefined);
  assert.deepEqual(seen.slice(1), Array.from({ length: 5 }, () => ({ status: 'reentrant' })));
  gate.resolve(); await model.idle(); model.observe(lead); await model.idle();
  assert.equal(host.title(child), undefined);
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'New task' });
  model.observe(lead); await model.idle(); assert.equal(host.title(child)?.title, 'New task');
});

test('reentrant callbacks cannot erase the new message controller', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const taskGate = deferred(), msgGate = deferred(), reentrant = [];
  let model, messageSignal;
  model = createModel(host, { generate: async ({ signal, subject }) => {
    signal.addEventListener('abort', () => reentrant.push(model.observe(lead)), { once: true });
    await taskGate.promise; return subject;
  } });
  model.observe(lead); await settle();
  model.message(child, async ({ signal }) => { messageSignal = signal; await msgGate.promise; return 'message'; });
  await settle(); assert.deepEqual(reentrant, [{ status: 'reentrant' }]);
  model.rename(child, 'Pinned'); assert.equal(messageSignal.aborted, true);
  taskGate.resolve(); msgGate.resolve(); await model.idle();
  assert.deepEqual(host.title(child), { kind: 'user', title: 'Pinned' });
});

test('reentrant callbacks during dispose do not skip other child cancellations', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const second = host.createChild('second', lead), signals = [], attempts = []; let model;
  host.task(lead, { id: 'second-task', revision: 1, status: 'pending', subject: 'second' });
  host.task(lead, { id: 'second-task', revision: 2, status: 'in_progress', ownerId: 'second', subject: 'second' });
  model = createModel(host, { generate: ({ signal }) => new Promise((resolve) => {
    signals.push(signal);
    signal.addEventListener('abort', () => {
      attempts.push(model.invalidate(child), model.observe(lead), model.dispose());
      resolve('ignored');
    }, { once: true });
  }) });
  model.observe(lead); await settle();
  const closing = model.dispose(); await closing;
  assert.equal(signals.length, 2); assert.ok(signals.every((signal) => signal.aborted));
  assert.deepEqual(attempts, Array.from({ length: 6 }, () => ({ status: 'reentrant' })));
  assert.equal(host.title(child), undefined); assert.equal(host.title(second), undefined);
  assert.doesNotThrow(() => createModel(host));
});

test('guard is released before invoking and awaiting task generator', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), seen = []; let model;
  model = createModel(host, { generate: async ({ subject }) => {
    seen.push(model.rename(child, 'Pinned'));
    await gate.promise; return subject;
  } });
  model.observe(lead); await settle(); gate.resolve(); await model.idle();
  assert.deepEqual(seen, [undefined]);
  assert.deepEqual(host.title(child), { kind: 'user', title: 'Pinned' });
});

test('synchronous host mutations in abort cannot authorize an outdated candidate', async () => {
  for (const mode of ['high', 'ambiguous', 'owner', 'authorization', 'disposed']) {
    const host = createSyntheticHost(); const { lead, child } = ready(host);
    const gate = deferred(), calls = []; let fired = false;
    const model = createModel(host, { generate: async (input) => {
      calls.push(input);
      if (!fired) input.signal.addEventListener('abort', () => {
        fired = true;
        if (mode === 'high') host.task(lead, { id: 'unrelated', revision: 1, status: 'pending', subject: 'X' });
        if (mode === 'ambiguous') {
          host.task(lead, { id: 'extra', revision: 1, status: 'pending', subject: 'X' });
          host.task(lead, { id: 'extra', revision: 2, status: 'in_progress', ownerId: 'child', subject: 'X' });
        }
        if (mode === 'owner') host.task(lead, { id: 'task', revision: 4, status: 'in_progress', ownerId: 'other', subject: 'B' });
        if (mode === 'authorization') host.setAuthorized(false);
        if (mode === 'disposed') host.disposeChild(child);
      }, { once: true });
      if (input.revision === 2) await gate.promise;
      return input.subject;
    } });
    model.observe(lead); await settle();
    host.task(lead, { id: 'task', revision: 3, status: 'in_progress', ownerId: 'child', subject: 'B' });
    model.observe(lead); gate.resolve(); await model.idle();
    assert.equal(fired, true, mode);
    assert.deepEqual(calls.map((call) => call.revision), [2], mode);
    assert.equal(host.title(child), undefined, mode);
  }
});

test('host mutation in one child abort does not consume a later child candidate', async () => {
  for (const mode of ['high', 'authorization']) {
    const host = createSyntheticHost(); host.setAuthorized(true);
    const lead = host.createLead('lead'), first = host.createChild('first', lead), second = host.createChild('second', lead);
    for (const [id, owner] of [['one', 'first'], ['two', 'second']]) {
      host.task(lead, { id, revision: 1, status: 'pending', subject: 'Old' });
      host.task(lead, { id, revision: 2, status: 'in_progress', ownerId: owner, subject: 'Old' });
    }
    const gate = deferred(); let model;
    model = createModel(host, { generate: async ({ taskId, revision, signal, subject }) => {
      if (taskId === 'one' && revision === 2) {
        signal.addEventListener('abort', () => {
          if (mode === 'high') host.task(lead, { id: 'extra', revision: 1, status: 'pending', subject: 'X' });
          else host.setAuthorized(false);
        }, { once: true });
        await gate.promise;
      }
      return subject;
    } });
    model.observe(lead); await settle();
    host.task(lead, { id: 'one', revision: 3, status: 'in_progress', ownerId: 'first', subject: 'New one' });
    host.task(lead, { id: 'two', revision: 3, status: 'in_progress', ownerId: 'second', subject: 'New two' });
    model.observe(lead); gate.resolve(); await model.idle();
    if (mode === 'authorization') host.setAuthorized(true);
    model.observe(lead); await model.idle();
    assert.deepEqual(host.title(first), { kind: 'task', title: 'New one', taskId: 'one', revision: 3 }, mode);
    assert.deepEqual(host.title(second), { kind: 'task', title: 'New two', taskId: 'two', revision: 3 }, mode);
  }
});

test('a replacement child created by a synchronous abort is not observed in the old pass', async () => {
  const host = createSyntheticHost(); host.setAuthorized(true);
  const lead = host.createLead('lead'); host.createChild('first', lead); const second = host.createChild('second', lead);
  for (const [id, owner] of [['one', 'first'], ['two', 'second']]) {
    host.task(lead, { id, revision: 1, status: 'pending', subject: 'Old' });
    host.task(lead, { id, revision: 2, status: 'in_progress', ownerId: owner, subject: 'Old' });
  }
  const gate = deferred(), calls = []; let replacement;
  const model = createModel(host, { generate: async (input) => {
    calls.push([input.taskId, input.revision]);
    if (input.taskId === 'one' && input.revision === 2) {
      input.signal.addEventListener('abort', () => { host.disposeChild(second); replacement = host.createChild('second', lead); }, { once: true });
      await gate.promise;
    }
    return input.subject;
  } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'one', revision: 3, status: 'in_progress', ownerId: 'first', subject: 'New one' });
  host.task(lead, { id: 'two', revision: 3, status: 'in_progress', ownerId: 'second', subject: 'New two' });
  model.observe(lead); gate.resolve(); await model.idle();
  assert.deepEqual(calls, [['one', 2], ['two', 2], ['one', 3]]);
  assert.equal(host.title(replacement), undefined);
  model.observe(lead); await model.idle(); assert.equal(host.title(replacement)?.title, 'New two');
});

test('incomplete later-child task view cannot abort pending message after any host mutation', async () => {
  for (const mode of ['authorization', 'lead-disposed', 'child-replaced']) {
    const host = createSyntheticHost(); host.setAuthorized(true);
    const lead = host.createLead('lead'); host.createChild('first', lead); const second = host.createChild('second', lead);
    for (const [id, owner] of [['one', 'first'], ['two', 'second']]) {
      host.task(lead, { id, revision: 1, status: 'pending', subject: 'Old' });
      host.task(lead, { id, revision: 2, status: 'in_progress', ownerId: owner, subject: 'Old' });
    }
    const firstGate = deferred(), messageGate = deferred(); let messageSignal;
    const model = createModel(host, { generate: async ({ taskId, revision, signal, subject }) => {
      if (taskId === 'one' && revision === 2) {
        signal.addEventListener('abort', () => {
          if (mode === 'authorization') host.setAuthorized(false);
          if (mode === 'lead-disposed') host.disposeLead(lead);
          if (mode === 'child-replaced') { host.disposeChild(second); host.createChild('second', lead); }
        }, { once: true });
        await firstGate.promise;
      }
      return subject;
    } });
    model.observe(lead); await settle();
    model.message(second, async ({ signal }) => { messageSignal = signal; await messageGate.promise; return 'New message'; });
    await settle();
    host.task(lead, { id: 'one', revision: 3, status: 'in_progress', ownerId: 'first', subject: 'New one' });
    host.task(lead, { id: 'two', revision: 3, status: 'in_progress', ownerId: 'second', subject: 'New two' });
    model.observe(lead);
    assert.equal(messageSignal.aborted, false, mode);
    firstGate.resolve(); messageGate.resolve(); await model.idle();
    assert.deepEqual(host.title(second), { kind: 'task', title: 'Old', taskId: 'two', revision: 2 }, mode);
  }
});

test('incomplete later-child task view cannot abort a newer message', async () => {
  const host = createSyntheticHost(); host.setAuthorized(true);
  const lead = host.createLead('lead'), first = host.createChild('first', lead), second = host.createChild('second', lead);
  for (const [id, owner] of [['one', 'first'], ['two', 'second']]) {
    host.task(lead, { id, revision: 1, status: 'pending', subject: 'Old' });
    host.task(lead, { id, revision: 2, status: 'in_progress', ownerId: owner, subject: 'Old' });
  }
  const firstGate = deferred(), messageGate = deferred(); let messageSignal;
  const model = createModel(host, { generate: async ({ taskId, revision, signal, subject }) => {
    if (taskId === 'one' && revision === 2) {
      signal.addEventListener('abort', () => host.task(lead, { id: 'extra', revision: 1, status: 'pending', subject: 'X' }), { once: true });
      await firstGate.promise;
    }
    return subject;
  } });
  model.observe(lead); await settle();
  model.message(second, async ({ signal }) => { messageSignal = signal; await messageGate.promise; return 'New message'; });
  await settle();
  host.task(lead, { id: 'one', revision: 3, status: 'in_progress', ownerId: 'first', subject: 'New one' });
  host.task(lead, { id: 'two', revision: 3, status: 'in_progress', ownerId: 'second', subject: 'New two' });
  model.observe(lead);
  assert.equal(messageSignal.aborted, false);
  firstGate.resolve(); messageGate.resolve(); await model.idle();
  assert.deepEqual(host.title(second), { kind: 'message', title: 'New message' });
});

test('abort callback restoring a unique candidate cannot leave it consumed as an empty selection', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), calls = [];
  const model = createModel(host, { generate: async (input) => {
    calls.push(input);
    if (input.taskId === 'task') {
      input.signal.addEventListener('abort', () => host.task(lead, { id: 'other', revision: 3, ownerId: 'child', status: 'completed', subject: 'B' }), { once: true });
      await gate.promise;
    }
    return input.subject;
  } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'B' });
  host.task(lead, { id: 'other', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'B' });
  model.observe(lead); gate.resolve(); await model.idle();
  assert.equal(host.title(child), undefined);
  model.observe(lead); await model.idle();
  assert.equal(calls.length, 2); assert.equal(host.title(child)?.title, 'Task A');
});

test('fenced old candidate can become fresh during its abort without being consumed', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), calls = [];
  const model = createModel(host, { generate: async (input) => {
    calls.push(input);
    if (input.revision === 2) {
      input.signal.addEventListener('abort', () => host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'B' }), { once: true });
      await gate.promise;
    }
    return input.subject;
  } });
  model.observe(lead); await settle(); model.invalidate(child); gate.resolve(); await model.idle();
  model.observe(lead); await model.idle();
  assert.equal(calls.length, 2); assert.equal(host.title(child)?.title, 'B');
});

test('host task mutation during abort permits explicit retry after stale outer observation', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), calls = [];
  const model = createModel(host, { generate: async (input) => {
    calls.push(input);
    if (input.revision === 2) {
      input.signal.addEventListener('abort', () => host.task(lead, { id: 'unrelated', revision: 1, status: 'pending', subject: 'Other' }), { once: true });
      await gate.promise;
    }
    return input.subject;
  } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'Latest' });
  model.observe(lead); gate.resolve(); await model.idle();
  assert.deepEqual(calls.map((input) => input.revision), [2]);
  assert.equal(host.title(child), undefined);
  model.observe(lead); await model.idle();
  assert.deepEqual(calls.map((input) => input.revision), [2, 3]);
  assert.equal(host.title(child)?.title, 'Latest');
});

test('a generator rejection after synchronous callback reentry still drains and can retry', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), seen = []; let calls = 0, model;
  model = createModel(host, { generate: async ({ signal, subject }) => {
    if (++calls === 1) {
      signal.addEventListener('abort', () => seen.push(model.observe(lead)), { once: true });
      await gate.promise;
      throw new Error('fixture rejected after abort');
    }
    return subject;
  } });
  model.observe(lead); await settle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'Later' });
  model.observe(lead); gate.resolve(); await model.idle();
  assert.deepEqual(seen, [{ status: 'reentrant' }]);
  assert.equal(calls, 2); assert.equal(host.title(child)?.title, 'Later');
  await model.dispose(); assert.doesNotThrow(() => createModel(host));
});

test('an abort callback may revoke a child without predispatching replacement message work', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let messageCalls = 0;
  const model = createModel(host, { generate: async ({ signal, subject }) => {
    signal.addEventListener('abort', () => host.disposeChild(child), { once: true });
    await gate.promise; return subject;
  } });
  model.observe(lead); await settle();
  model.message(child, async () => { messageCalls++; return 'Not allowed'; });
  gate.resolve(); await model.idle();
  assert.equal(messageCalls, 0); assert.equal(host.title(child), undefined);
});

test('explicit invalidation survives ambiguous tasks then preserves the same candidate fence', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); const calls = [];
  const model = createModel(host, { generate: async (input) => { calls.push(input); if (calls.length === 1) await gate.promise; return input.subject; } });
  model.observe(lead); await settle(); model.invalidate(child);
  assert.equal(calls[0].signal.aborted, true);
  gate.resolve(); await model.idle();
  host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'B' });
  host.task(lead, { id: 'other', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'B' });
  model.observe(lead); await model.idle();
  host.task(lead, { id: 'other', revision: 3, ownerId: 'child', status: 'completed', subject: 'B' });
  model.observe(lead); await model.idle();
  assert.equal(calls.length, 1);
  assert.equal(host.title(child), undefined);
});

test('explicit invalidation blocks a previously committed candidate across ambiguity', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.observe(lead); await model.idle(); model.invalidate(child);
  host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'B' });
  host.task(lead, { id: 'other', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'B' });
  model.observe(lead); await model.idle();
  host.task(lead, { id: 'other', revision: 3, ownerId: 'child', status: 'completed', subject: 'B' });
  model.observe(lead); await model.idle();
  assert.equal(calls, 1);
  assert.deepEqual(host.title(child), { kind: 'task', title: 'Task A', taskId: 'task', revision: 2 });
});

test('invalidation before selection blocks the currently unique synthetic candidate', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.invalidate(child); model.observe(lead); await model.idle();
  assert.equal(calls, 0); assert.equal(host.title(child), undefined);
});

test('invalidation while ambiguous fences both known candidates', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); const calls = [];
  host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'B' });
  host.task(lead, { id: 'other', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'B' });
  const model = createModel(host, { generate: async (input) => { calls.push(input); return input.subject; } });
  model.observe(lead); model.invalidate(child);
  host.task(lead, { id: 'other', revision: 3, ownerId: 'child', status: 'completed', subject: 'B' });
  model.observe(lead); await model.idle();
  assert.equal(calls.length, 0); assert.equal(host.title(child), undefined);
});

test('child disposal and recreation do not inherit an old cancellation watermark', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.invalidate(child); host.disposeChild(child); model.invalidate(child);
  const replacement = host.createChild('child', lead);
  model.observe(lead); await model.idle();
  assert.equal(calls, 1);
  assert.deepEqual(host.title(replacement), { kind: 'task', title: 'Task A', taskId: 'task', revision: 2 });
});

test('invalidate without its original live lead cannot fence or update a rebuilt lead', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  host.disposeLead(lead);
  const replacementLead = host.createLead('lead');
  model.invalidate(child);
  host.task(replacementLead, { id: 'task', revision: 1, status: 'pending', subject: 'New lead task' });
  host.task(replacementLead, { id: 'task', revision: 2, ownerId: 'child', status: 'in_progress', subject: 'New lead task' });
  model.observe(replacementLead); await model.idle();
  assert.equal(calls, 0); assert.equal(host.title(child), undefined);
  host.disposeChild(child); model.invalidate(child);
  const replacementChild = host.createChild('child', replacementLead);
  model.observe(replacementLead); await model.idle();
  assert.equal(calls, 1);
  assert.equal(host.title(replacementChild)?.title, 'New lead task');
});

test('message watermark remains effective after separate explicit invalidation', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.message(child, async () => 'Message wins'); await model.idle();
  model.invalidate(child); model.observe(lead); await model.idle();
  assert.equal(calls, 0);
  assert.deepEqual(host.title(child), { kind: 'message', title: 'Message wins' });
});

test('an old disposed child invalidation cannot cancel replacement child work', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(); let signal;
  const model = createModel(host, { generate: async (input) => { signal = input.signal; await gate.promise; return input.subject; } });
  host.disposeChild(child); const replacement = host.createChild('child', lead);
  model.observe(lead); await settle(); model.invalidate(child);
  assert.equal(signal.aborted, false);
  gate.resolve(); await model.idle();
  assert.equal(host.title(replacement)?.title, 'Task A');
});

test('message fence remains monotonic across repeated user messages', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.message(child, async () => 'First'); await model.idle();
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'B' });
  model.message(child, async () => 'Second'); await model.idle();
  model.observe(lead); await model.idle();
  assert.equal(calls, 0); assert.deepEqual(host.title(child), { kind: 'message', title: 'Second' });
  host.task(lead, { id: 'task', revision: 4, ownerId: 'child', status: 'in_progress', subject: 'C' });
  model.observe(lead); await model.idle(); assert.equal(calls, 1); assert.equal(host.title(child)?.title, 'C');
});

test('child dispose without explicit invalidation still rejects a cooperative late result', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host);
  const gate = deferred(), model = createModel(host, { generate: async ({ subject }) => { await gate.promise; return subject; } });
  model.observe(lead); await settle(); host.disposeChild(child);
  const replacement = host.createChild('child', lead);
  gate.resolve(); await model.idle();
  assert.equal(host.title(child), undefined); assert.equal(host.title(replacement), undefined);
});

test('repeated invalidations use the latest synthetic cut', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.invalidate(child);
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'B' });
  model.invalidate(child); model.observe(lead); await model.idle(); assert.equal(calls, 0);
  host.task(lead, { id: 'task', revision: 4, ownerId: 'child', status: 'in_progress', subject: 'C' });
  model.observe(lead); await model.idle(); assert.equal(calls, 1); assert.equal(host.title(child)?.title, 'C');
});

test('a new revision of an invalidated candidate can be generated', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.observe(lead); await model.idle(); model.invalidate(child);
  host.task(lead, { id: 'task', revision: 3, ownerId: 'child', status: 'in_progress', subject: 'Task A updated' });
  model.observe(lead); await model.idle();
  assert.equal(calls, 2);
  assert.deepEqual(host.title(child), { kind: 'task', title: 'Task A updated', taskId: 'task', revision: 3 });
});

test('a truly different candidate after invalidation may be generated', async () => {
  const host = createSyntheticHost(); const { lead, child } = ready(host); let calls = 0;
  const model = createModel(host, { generate: async ({ subject }) => { calls++; return subject; } });
  model.observe(lead); await model.idle(); model.invalidate(child);
  host.task(lead, { id: 'task', revision: 3, status: 'completed', ownerId: 'child', subject: 'Task A' });
  host.task(lead, { id: 'other', revision: 1, status: 'pending', subject: 'B' });
  host.task(lead, { id: 'other', revision: 2, status: 'in_progress', ownerId: 'child', subject: 'B' });
  model.observe(lead); await model.idle();
  assert.equal(calls, 2);
  assert.deepEqual(host.title(child), { kind: 'task', title: 'B', taskId: 'other', revision: 2 });
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
  assert.equal(observedAbort, true); // child invalidation itself must abort; not just service disposal
  await model.dispose();
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

'use strict';
// Synthetic-only native rc.5 research. The PTC runtime below never executes code.
const test = require('node:test');
const assert = require('node:assert/strict');
// This helper imports Node built-ins only; no installed app module is loaded
// until loadPinned verifies the installed baseline for this environment.
const { loadPinned } = require('./baseline-gate.cjs');
const config = { provider: 'fake', maxConcurrentAgents: 1, maxTotalAgents: 10, maxItemsPerCall: 10, syncTimeoutMs: 500 };
const request = () => ({
  script: 'return 1;',
  meta: { name: 'fixture', description: 'synthetic', phases: [{ title: 'one' }] },
  args: { marker: 'original' },
  parent: { session: { id: 'synthetic-session' } },
});
const outcome = { value: { value: null, stopReason: 'completed', agentsStarted: 0 } };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function environment(options = {}) {
  const [{ Context }, { default: PtcWorkflowEngine }] = await loadPinned();
  const ctx = new Context();
  const reached = deferred();
  const events = [];
  let runtimeInput;
  let beginCalls = 0;
  ctx.provide('subagents', { getProvider: options.getProvider ?? ((name) => name === 'fake' ? {} : undefined) });
  ctx.provide('sandboxPolicy', { resolve() { return { mode: 'danger-full-access' }; } });
  ctx.provide('workingDirectory', { ensure() { return Promise.resolve('/synthetic-not-used'); } });
  ctx.provide('ptcRuntime', {
    language: 'typescript',
    programFormat: 'module',
    resolve(input) { return input; },
    run(input) {
      runtimeInput = input;
      reached.resolve();
      if (options.runtimeError) return Promise.resolve({ error: { kind: 'synthetic', message: 'inert failure' } });
      if (options.pending) return new Promise((resolve) => {
        const finish = () => resolve(outcome);
        if (input.signal.aborted) finish();
        else input.signal.addEventListener('abort', finish, { once: true });
      });
      return Promise.resolve(outcome);
    },
  });
  ctx.on('workflow/start', (info) => {
    events.push(['start', info]);
    options.onStart?.(info);
  });
  ctx.on('workflow/end', (info, result) => events.push(['end', info, result]));
  await ctx.plugin(PtcWorkflowEngine, config);
  return {
    ctx, events,
    get reachedRuntime() { return runtimeInput !== undefined; },
    get beginCalls() { return beginCalls; },
    async waitForRuntime() { await reached.promise; },
    async begin() {
      // The fake runtime receives the real host binding and simulates a guest
      // request to begin. No guest program or transport is run.
      await reached.promise;
      beginCalls++;
      return runtimeInput.bindings[0].functions.begin({});
    },
    async close(run) {
      if (run) await run.dispose();
      await ctx.fiber.dispose();
    },
  };
}

function detach(value) {
  // Used only to capture the synthetic event as seen at a known instant.
  return structuredClone(value);
}

test('ordinary fixture: begin returns detached data; prior request args and meta do not alias', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    const input = request();
    run = env.ctx.workflowEngine.start(input);
    input.meta.phases[0].title = 'request changed';
    input.args.marker = 'request changed';
    const response = await env.begin();
    assert.equal(response.body, 'return 1;');
    assert.equal(response.meta.phases[0].title, 'one');
    assert.equal(response.args.marker, 'original');
    assert.notStrictEqual(response, run.init);
    assert.notStrictEqual(response.meta, run.init.meta);
    response.meta.phases[0].title = 'response changed';
    response.args.marker = 'response changed';
    assert.equal(run.init.meta.phases[0].title, 'one');
    assert.equal(run.init.args.marker, 'original');
  } finally { await env.close(run); }
});

test('start event changes aliased normalized meta before begin; event snapshot is not begin response', async () => {
  let eventSnapshot;
  let eventInfo;
  const env = await environment({
    pending: true,
    onStart(info) {
      eventInfo = info;
      eventSnapshot = detach(info.meta);
      info.meta.name = 'event-mutated';
      info.meta.phases[0].title = 'event phase';
    },
  });
  let run;
  try {
    const input = request();
    run = env.ctx.workflowEngine.start(input);
    assert.strictEqual(eventInfo.meta, run.meta);
    assert.strictEqual(eventInfo.meta, run.init.meta);
    assert.notStrictEqual(eventInfo.meta, input.meta);
    assert.equal(eventSnapshot.name, 'fixture');
    assert.equal(input.meta.name, 'fixture');
    const response = await env.begin();
    assert.equal(response.meta.name, 'event-mutated');
    assert.equal(response.meta.phases[0].title, 'event phase');
    assert.equal(response.body, 'return 1;');
    assert.notDeepEqual(response.meta, eventSnapshot);
  } finally { await env.close(run); }
});

test('returned run.init may change body, meta, args and limits before actual begin', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    const input = request();
    run = env.ctx.workflowEngine.start(input);
    const eventSnapshot = detach(env.events[0][1].meta);
    const initial = detach(run.init);
    run.init.body = 'return 2;';
    run.init.meta.description = 'changed after start';
    run.init.args.marker = 'changed after start';
    run.init.limits.maxTotalAgents = 1;
    const response = await env.begin();
    assert.equal(initial.body, input.script);
    assert.equal(initial.meta.description, 'synthetic');
    assert.equal(eventSnapshot.description, 'synthetic');
    assert.equal(response.body, 'return 2;');
    assert.equal(response.meta.description, 'changed after start');
    assert.equal(response.args.marker, 'changed after start');
    assert.equal(response.limits.maxTotalAgents, 1);
    assert.notEqual(response.body, input.script);
    assert.notDeepEqual(response.meta, eventSnapshot);
  } finally { await env.close(run); }
});

test('an explicitly gated microtask can modify init after runtime receives binding but before begin', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    run = env.ctx.workflowEngine.start(request());
    await env.waitForRuntime();
    const before = detach(run.init);
    // Runtime has the real binding but has not called begin. Explicitly queue
    // mutation first; this does not claim production scheduling is identical.
    const order = [];
    const mutation = Promise.resolve().then(() => {
      run.init.body = 'return 3;';
      run.init.meta.name = 'microtask';
      order.push('mutation');
    });
    const responsePromise = Promise.resolve().then(async () => {
      order.push('begin-request');
      return env.begin();
    });
    const [, response] = await Promise.all([mutation, responsePromise]);
    assert.deepEqual(order, ['mutation', 'begin-request']);
    assert.equal(before.body, 'return 1;');
    assert.equal(response.body, 'return 3;');
    assert.equal(response.meta.name, 'microtask');
  } finally { await env.close(run); }
});

test('native begin is repeatable and each response reflects the then-current init', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    run = env.ctx.workflowEngine.start(request());
    const first = await env.begin();
    run.init.body = 'return 4;';
    run.init.meta.phases[0].title = 'between calls';
    const second = await env.begin();
    assert.equal(first.body, 'return 1;');
    assert.equal(first.meta.phases[0].title, 'one');
    assert.equal(second.body, 'return 4;');
    assert.equal(second.meta.phases[0].title, 'between calls');
    assert.notStrictEqual(first, second);
  } finally { await env.close(run); }
});

test('begin after cancel throws; cancellation resolves and emits one end even after disposal', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    run = env.ctx.workflowEngine.start(request());
    const first = await env.begin();
    assert.equal(first.body, 'return 1;');
    run.cancel('fixture cancellation');
    await assert.rejects(env.begin(), /fixture cancellation|abort/i);
    const result = await run.result;
    assert.equal(result.stopReason, 'cancelled');
    await run.dispose();
    await Promise.resolve();
    assert.equal(env.events.filter(([kind]) => kind === 'start').length, 1);
    assert.equal(env.events.filter(([kind]) => kind === 'end').length, 1);
    assert.equal(env.events.find(([kind]) => kind === 'end')[2].stopReason, 'cancelled');
  } finally { await env.close(run); }
});

test('never-begun cancellation creates no guest response', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    run = env.ctx.workflowEngine.start(request());
    run.cancel('cancel before drive');
    assert.equal((await run.result).stopReason, 'cancelled');
    await Promise.resolve();
    assert.deepEqual(env.events.map(([kind]) => kind), ['start', 'end']);
    assert.equal(env.reachedRuntime, false);
    assert.equal(env.beginCalls, 0);
    // begin() is intentionally not called and the fake runtime is not reached.
  } finally { await env.close(run); }
});

test('invalid initial script throws synchronously without start event or run', async () => {
  const env = await environment({ pending: true });
  try {
    assert.throws(() => env.ctx.workflowEngine.start({ ...request(), script: 'await (' }), (error) => error.code === 'SCRIPT_PARSE');
    assert.deepEqual(env.events, []);
  } finally { await env.close(); }
});

test('native runtime error resolves with error and emits one end without guest begin', async () => {
  const env = await environment({ runtimeError: true });
  let run;
  try {
    run = env.ctx.workflowEngine.start(request());
    const result = await run.result;
    await Promise.resolve();
    assert.equal(result.stopReason, 'error');
    assert.match(result.error, /inert failure/);
    assert.deepEqual(env.events.map(([kind]) => kind), ['start', 'end']);
    assert.equal(env.events[1][2].stopReason, 'error');
    assert.equal(env.reachedRuntime, true);
    assert.equal(env.beginCalls, 0);
    // The fake runtime returned an error; it did not ask for begin or execute code.
  } finally { await env.close(run); }
});

test('dynamic script getter can differ between host parse and init construction', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    const input = request();
    let reads = 0;
    Object.defineProperty(input, 'script', { enumerable: true, get() { reads++; return reads === 1 ? 'return 1;' : 'await ('; } });
    run = env.ctx.workflowEngine.start(input);
    assert.equal(reads, 2);
    const response = await env.begin();
    assert.equal(response.body, 'await (');
    assert.equal(reads, 2);
    // This malformed body was not re-parsed or executed by the fake runtime.
  } finally { await env.close(run); }
});

test('normalized meta getter is re-read after validation; begin captures actual later value', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    const input = request();
    let reads = 0;
    Object.defineProperty(input.meta, 'name', { enumerable: true, get() { reads++; return reads <= 2 ? 'checked' : 'later'; } });
    run = env.ctx.workflowEngine.start(input);
    assert.equal(reads, 3);
    assert.equal(env.events[0][1].meta.name, 'later');
    assert.equal((await env.begin()).meta.name, 'later');
    assert.equal(reads, 3);
  } finally { await env.close(run); }
});

test('begin JSON snapshot reads a mutable accessor once per invocation', async () => {
  const env = await environment({ pending: true });
  let run;
  try {
    run = env.ctx.workflowEngine.start(request());
    let reads = 0;
    Object.defineProperty(run.init, 'body', { enumerable: true, configurable: true, get() { return `body-${++reads}`; } });
    const first = await env.begin();
    const second = await env.begin();
    assert.equal(first.body, 'body-1');
    assert.equal(second.body, 'body-2');
    assert.equal(reads, 2);
  } finally { await env.close(run); }
});

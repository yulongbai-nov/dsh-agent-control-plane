// Synthetic test only: run with the installed Electron CLI in Node mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { apply as forkApply, candidatesFor } from '../fork.mjs';

const base = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/';
const load = (path) => import(pathToFileURL(base + path));
const source = { script: 'return 1;', meta: { name: 'synthetic', description: 'fixture', phases: [{ title: 'phase' }] } };
const copy = (value) => JSON.parse(JSON.stringify(value));
const config = { toolName: 'custom-flow', maxResultChars: 1000, enableRunInBackground: true };

async function environment(kind, options = {}) {
  const { Context } = await load('cordis/lib/index.js');
  const { SystemPrompt } = await load('dsh-system-prompt/lib/index.js');
  const { ToolRuntime } = await load('dsh-tools/lib/index.js');
  const original = await load('dsh-tool-workflow/lib/index.js');
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  const events = [], starts = [], disposals = [], cancels = [];
  const agent = { id: 'agent', session: { id: 'session', append(type, data) { events.push({ type, data: copy(data) }); } } };
  let resolve, jobHooks, jobCall;
  const jobLogs = [], jobProgress = [];
  ctx.workflowEngine = { start(request) {
    starts.push(request);
    if (options.throwStart) throw new Error('parse rejected');
    const { promise, resolve: done } = Promise.withResolvers(); resolve = done;
    const run = { id: 'run', meta: request.meta, result: promise, cancel(reason) { cancels.push(reason); done({ stopReason: 'cancelled', agentsStarted: 0 }); }, async dispose() { disposals.push('dispose'); } };
    if (options.members) queueMicrotask(() => {
      const info = { id: 'run', meta: request.meta };
      ctx.emit('workflow/phase', info, 'phase');
      ctx.emit('workflow/log', info, 'synthetic log');
      ctx.emit('workflow/agent-start', info, { seq: 1, label: 'one', phase: 'phase', childId: 'child' });
      ctx.emit('workflow/agent-end', info, { seq: 1, label: 'one', phase: 'phase', childId: 'child', outcome: 'completed' });
    });
    if (!options.pending) queueMicrotask(() => done(options.result ?? { stopReason: 'completed', agentsStarted: options.members ? 1 : 0, value: 1 }));
    return run;
  } };
  if (options.admissionDenied) {
    ctx.reflect.provide('jobs', { start() { throw new Error('fixture admission denied'); } });
  } else if (options.realJobs) {
    const { LocalJobRegistry } = await load('dsh-jobs-local/lib/index.js');
    agent.ctx = ctx;
    ctx.reflect.provide('agents', { get(id) { return id === agent.id ? agent : undefined; } });
    await ctx.plugin(LocalJobRegistry);
    ctx.jobs.attachController('synthetic-test');
  } else if (options.background) {
    ctx.reflect.provide('jobs', { start(spec) {
      jobCall = copy({ kind: spec.kind, label: spec.label, owner: spec.owner, toolCall: spec.toolCall });
      const job = { id: 'job', append(text, options) { jobLogs.push({ text, options }); }, updateProgress(line) { jobProgress.push(line); } };
      jobHooks = spec.run(job);
      return job.id;
    } });
  }
  const sections = [];
  if (options.capturePrompt) {
    const target = ctx.systemPrompt;
    const originalSection = target.section;
    target.section = function (section) { sections.push(section); return originalSection.call(this, section); };
  }
  if (kind === 'fork') forkApply(ctx, { ...config, ...options.config }); else original.apply(ctx, { ...config, ...options.config });
  const execute = (args = source, signal = new AbortController().signal, parent) => ctx.tools.execute({ name: 'custom-flow', callId: 'call', agent, arguments: args, signal, ...(parent === undefined ? {} : { parent }) });
  return { ctx, agent, starts, events, disposals, cancels, execute, sections, jobLogs, jobProgress, get jobHooks() { return jobHooks; }, get jobCall() { return jobCall; }, resolve: (value) => resolve(value) };
}

async function compare(options, args = source) {
  const a = await environment('original', options), b = await environment('fork', options);
  try {
    const [left, right] = await Promise.all([a.execute(args), b.execute(args)]);
    assert.deepEqual(right, left);
    if (a.jobHooks && b.jobHooks) assert.deepEqual(await b.jobHooks.done, await a.jobHooks.done);
    assert.deepEqual(b.jobCall, a.jobCall);
    assert.deepEqual(b.jobLogs, a.jobLogs);
    assert.deepEqual(b.jobProgress, a.jobProgress);
    assert.deepEqual(b.events, a.events);
    assert.deepEqual(b.disposals, a.disposals);
    assert.deepEqual(b.cancels, a.cancels);
    return { a, b, left, right, candidates: candidatesFor(b.ctx) };
  } finally { await a.ctx.fiber.dispose(); await b.ctx.fiber.dispose(); }
}

test('registered prompt, schema, output and presentation metadata match original', async () => {
  const a = await environment('original', { capturePrompt: true }), b = await environment('fork', { capturePrompt: true });
  try {
    assert.deepEqual(b.sections, a.sections);
    assert.match(a.sections[0].text, /ONLY when the user explicitly asks/);
    const left = a.ctx.tools.get('custom-flow', a.agent), right = b.ctx.tools.get('custom-flow', b.agent);
    assert.deepEqual(right.parameters, left.parameters);
    assert.deepEqual(right.output.schema, left.output.schema);
    assert.equal(right.description, left.description);
    assert.deepEqual(right.presentCall(source), left.presentCall(source));
    const result = { kind: 'foreground', runId: 'run', agentsStarted: 0, result: 1 };
    assert.deepEqual(right.presentResult(source, result), left.presentResult(source, result));
    assert.deepEqual(right.output.render(source, result), left.output.render(source, result));
  } finally { await a.ctx.fiber.dispose(); await b.ctx.fiber.dispose(); }
});

test('append failures do not alter native result or fabricate downstream records', async () => {
  const a = await environment('original'), b = await environment('fork');
  try {
    a.agent.session.append = b.agent.session.append = () => { throw new Error('append fixture failure'); };
    const [left, right] = await Promise.all([a.execute(), b.execute()]);
    assert.deepEqual(right, left);
    assert.equal(right.isError, false);
    assert.deepEqual(a.events, []);
    assert.deepEqual(b.events, []);
    assert.equal(candidatesFor(b.ctx)[0].status, 'unverified');
  } finally { await a.ctx.fiber.dispose(); await b.ctx.fiber.dispose(); }
});

test('foreground output and native run events match the original tool', async () => {
  const { candidates: values } = await compare();
  assert.equal(values.length, 1);
  assert.deepEqual(values[0], { status: 'unverified', sessionId: 'session', callId: 'call', rootCallId: 'call', runId: 'run', kind: 'foreground', script: source.script, meta: source.meta });
});

test('plugin disposal clears synthetic candidate memory', async () => {
  const env = await environment('fork');
  await env.execute();
  assert.equal(candidatesFor(env.ctx).length, 1);
  await env.ctx.fiber.dispose();
  assert.deepEqual(candidatesFor(env.ctx), []);
});

test('synchronous engine rejection has no invented run and matches original error', async () => {
  const { candidates, right } = await compare({ throwStart: true });
  assert.equal(right.isError, true);
  assert.deepEqual(candidates, []);
});

test('failing run retains original error and lifecycle', async () => {
  const { right } = await compare({ result: { stopReason: 'error', error: 'synthetic failure', agentsStarted: 0 } });
  assert.equal(right.isError, true);
});

test('background output, job handle, and records match original', async () => {
  const { candidates, right, b } = await compare({ background: true, members: true }, { ...source, run_in_background: true });
  assert.deepEqual(b.events.map((event) => event.type), ['tool-workflow/run-start', 'tool-workflow/agent-start', 'tool-workflow/agent-end', 'tool-workflow/run-end']);
  assert.equal(b.jobLogs.length, 4);
  assert.deepEqual(b.jobProgress, ['phase']);
  assert.equal(right.isError, false, JSON.stringify(right));
  assert.equal(right.value.kind, 'background');
  assert.deepEqual(candidates.map(({ kind, jobId }) => ({ kind, jobId })), [{ kind: 'background', jobId: 'job' }]);
  assert.equal(candidates[0].jobId, 'job');
  assert.equal(candidates[0].runId, 'run');
  assert.equal(candidates[0].status, 'unverified');
});

test('background admission rejection never starts a workflow or candidate', async () => {
  const { a, b, right, candidates } = await compare({ admissionDenied: true }, { ...source, run_in_background: true });
  assert.equal(right.isError, true);
  assert.deepEqual(a.starts, []);
  assert.deepEqual(b.starts, []);
  assert.deepEqual(candidates, []);
});

test('background cancellation maps to the same run cancellation and outcome', async () => {
  const a = await environment('original', { background: true, pending: true }), b = await environment('fork', { background: true, pending: true });
  try {
    const args = { ...source, run_in_background: true };
    assert.deepEqual(await b.execute(args), await a.execute(args));
    a.jobHooks.cancel('synthetic cancellation');
    b.jobHooks.cancel('synthetic cancellation');
    assert.deepEqual(await b.jobHooks.done, await a.jobHooks.done);
    assert.deepEqual(b.cancels, a.cancels);
    assert.deepEqual(b.disposals, a.disposals);
    assert.deepEqual(b.events, a.events);
  } finally { await a.ctx.fiber.dispose(); await b.ctx.fiber.dispose(); }
});

test('background observes job lifecycle instead of the parent step signal', async () => {
  for (const kind of ['original', 'fork']) {
    const env = await environment(kind, { background: true, pending: true });
    try {
      const controller = new AbortController();
      const result = await env.execute({ ...source, run_in_background: true }, controller.signal);
      assert.equal(result.isError, false);
      controller.abort();
      assert.deepEqual(env.cancels, []);
      env.jobHooks.cancel('fixture cleanup');
      await env.jobHooks.done;
    } finally { await env.ctx.fiber.dispose(); }
  }
});

test('real rc.5 LocalJobRegistry links and cancels a synthetic background run', async () => {
  const env = await environment('fork', { realJobs: true, pending: true, members: true });
  try {
    const result = await env.execute({ ...source, run_in_background: true });
    assert.equal(result.isError, false, JSON.stringify(result));
    const { jobId, runId } = result.value;
    assert.equal(runId, 'run');
    const candidate = candidatesFor(env.ctx)[0];
    assert.equal(candidate.jobId, jobId);
    assert.equal(candidate.runId, runId);
    assert.equal(env.ctx.jobs.get(jobId, 'agent').status, 'running');
    await assert.rejects(async () => env.ctx.jobs.get(jobId, 'foreign-session'), /belongs to another session/);
    await env.ctx.jobs.kill(jobId, 'agent', 'fixture kill');
    const settled = await env.ctx.jobs.wait(jobId, 5000, 'agent');
    assert.equal(settled.status, 'killed');
    assert.deepEqual(env.cancels, ['fixture kill']);
    assert.deepEqual(env.disposals, ['dispose']);
    assert.deepEqual(env.events.filter((e) => e.type.startsWith('tool-workflow/')).map((e) => e.type), ['tool-workflow/run-start', 'tool-workflow/agent-start', 'tool-workflow/agent-end', 'tool-workflow/run-end']);
  } finally { await env.ctx.fiber.dispose(); }
});

test('actual agent-scope shadow and around short-circuit do not produce candidates', async () => {
  const { createScope } = await load('dsh-scope/lib/index.js');
  const { defineTool } = await load('dsh-tools/lib/index.js');
  const env = await environment('fork');
  const scoped = createScope(env.ctx, env.agent);
  try {
    await scoped.ctx.plugin({ inject: ['tools'], apply(ctx) { ctx.tools.register(defineTool({ name: 'custom-flow', parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string' }, runId: { type: 'string' }, agentsStarted: { type: 'integer' }, result: { type: 'json' } } }, render: () => [{ type: 'text', text: 'shadow' }] }, execute: () => ({ kind: 'foreground', runId: 'shadow', agentsStarted: 0, result: null }) })); } });
    const result = await env.execute();
    assert.equal(result.isError, false);
    assert.equal(env.starts.length, 0);
    assert.deepEqual(candidatesFor(env.ctx), []);
  } finally { await scoped.dispose(); await env.ctx.fiber.dispose(); }
  const short = await environment('fork');
  try {
    short.ctx.on('tools/execute', () => ({ isError: false, value: { kind: 'foreground', runId: 'forged', agentsStarted: 0, result: null } }));
    assert.equal((await short.execute()).value.runId, 'forged');
    assert.deepEqual(candidatesFor(short.ctx), []);
  } finally { await short.ctx.fiber.dispose(); }
});

test('background registry failure after start leaves a run candidate without inventing a job', async () => {
  const env = await environment('fork', { background: true, pending: true });
  try {
    const jobs = env.ctx.get('jobs');
    const start = jobs.start;
    jobs.start = (spec) => { start(spec); throw new Error('registration failed after starter'); };
    const result = await env.execute({ ...source, run_in_background: true });
    assert.equal(result.isError, true);
    const [candidate] = candidatesFor(env.ctx);
    assert.equal(candidate.runId, 'run');
    assert.equal('jobId' in candidate, false);
    assert.equal(candidate.status, 'unverified');
    env.jobHooks.cancel('fixture cleanup');
    await env.jobHooks.done;
  } finally { await env.ctx.fiber.dispose(); }
});

test('nested workflow calls do not fabricate top-level native records', async () => {
  const a = await environment('original'), b = await environment('fork');
  try {
    const parent = { id: 'ptc-parent' };
    const [left, right] = await Promise.all([a.execute(source, new AbortController().signal, parent), b.execute(source, new AbortController().signal, parent)]);
    assert.deepEqual(right, left);
    assert.deepEqual(a.events, []);
    assert.deepEqual(b.events, []);
    assert.equal(candidatesFor(b.ctx)[0].status, 'unverified');
  } finally { await a.ctx.fiber.dispose(); await b.ctx.fiber.dispose(); }
});

test('synthetic engine mutation during start proves candidate is not accepted init', async () => {
  const env = await environment('fork');
  try {
    env.ctx.workflowEngine.start = (request) => {
      request.script = 'return 2;';
      request.meta.name = 'changed';
      env.starts.push({ script: request.script, meta: copy(request.meta) });
      return { id: 'run', meta: request.meta, result: Promise.resolve({ stopReason: 'completed', agentsStarted: 0, value: 2 }), cancel() {}, async dispose() {} };
    };
    // Replacement meta simulates a mutable engine-facing request after normal tool validation.
    env.ctx.on('tools/execute', async (exec, next) => { exec.arguments = copy(exec.arguments); return next(); });
    const result = await env.execute();
    assert.equal(result.isError, false);
    assert.equal(env.starts[0].script, 'return 2;');
    assert.equal(candidatesFor(env.ctx)[0].script, 'return 1;');
    assert.equal(candidatesFor(env.ctx)[0].meta.name, 'synthetic');
    assert.equal(candidatesFor(env.ctx)[0].status, 'unverified');
  } finally { await env.ctx.fiber.dispose(); }
});

test('permission rejection and disabled background do not start or capture', async () => {
  for (const kind of ['original', 'fork']) {
    const env = await environment(kind, { config: { enableRunInBackground: false } });
    try {
      const disabled = await env.execute({ ...source, run_in_background: true });
      assert.equal(disabled.isError, true);
      env.ctx.tools.guard(() => 'synthetic permission denied');
      const blocked = await env.execute();
      assert.equal(blocked.isError, true);
      assert.deepEqual(env.starts, []);
      assert.deepEqual(candidatesFor(env.ctx), []);
    } finally { await env.ctx.fiber.dispose(); }
  }
});

test('snapshot errors and unsupported metadata cannot affect workflow execution', async () => {
  const { types } = await import('node:util');
  const original = types.isProxy;
  types.isProxy = () => { throw new Error('snapshot fault'); };
  try {
    const { right, candidates } = await compare();
    assert.equal(right.isError, false);
    assert.deepEqual(candidates, []);
  } finally { types.isProxy = original; }
});

test('around wrapper can alter effective arguments, but candidate cannot certify raw tool/call', async () => {
  const env = await environment('fork');
  try {
    env.ctx.on('tools/execute', async (exec, next) => {
      exec.arguments = { ...exec.arguments, script: 'return 2;' };
      return next();
    });
    const result = await env.execute();
    assert.equal(result.isError, false);
    assert.equal(env.starts[0].script, 'return 2;');
    assert.equal(candidatesFor(env.ctx)[0].script, 'return 2;');
    assert.equal(candidatesFor(env.ctx)[0].status, 'unverified');
    assert.equal(source.script, 'return 1;');
  } finally { await env.ctx.fiber.dispose(); }
});

test('source collection does not add calls to session accessors', async () => {
  const counts = [];
  for (const kind of ['original', 'fork']) {
    const env = await environment(kind);
    let reads = 0;
    try {
      env.ctx.on('tools/execute', async (exec, next) => {
        exec.agent = { id: 'agent', get session() { reads++; return { id: 'session', append() {} }; } };
        return next();
      });
      const result = await env.execute();
      assert.equal(result.isError, false);
      assert.equal(env.starts.length, 1);
      assert.deepEqual(candidatesFor(env.ctx), []);
      counts.push(reads);
    } finally { await env.ctx.fiber.dispose(); }
  }
  assert.deepEqual(counts, [1, 1]);
});

test('foreground abort invokes the same cancellation reason and disposal', async () => {
  const a = await environment('original', { pending: true }), b = await environment('fork', { pending: true });
  try {
    const c = new AbortController(), d = new AbortController();
    const left = a.execute(source, c.signal), right = b.execute(source, d.signal);
    await new Promise((resolve) => setImmediate(resolve));
    c.abort(); d.abort();
    assert.deepEqual(await right, await left);
    assert.deepEqual(b.cancels, a.cancels);
    assert.deepEqual(b.disposals, a.disposals);
    assert.deepEqual(b.events, a.events);
  } finally { await a.ctx.fiber.dispose(); await b.ctx.fiber.dispose(); }
});

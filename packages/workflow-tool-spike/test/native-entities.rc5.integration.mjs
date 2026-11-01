// Real rc.5 in-memory Agent/Session/tool/engine with inert fake runtime; no user sessions or code execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { apply, candidatesFor } from '../fork.mjs';
const base = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/';
const load = (path) => import(pathToFileURL(base + path));
const descriptor = (object, key) => {
  for (let value = object, level = 0; value; value = Object.getPrototypeOf(value), level++) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property) return { level, kind: Object.hasOwn(property, 'value') ? 'data' : 'accessor' };
  }
};

test('native rc.5 Agent, Session and PTC run reveal missing own session.id', async () => {
  const [{ Context }, { SessionStore }, { SessionProjectionRegistry }, { AgentRegistry }, { AgentLoop }, { SystemPrompt }, { ToolRuntime }, { default: PtcWorkflowEngine }] = await Promise.all([
    'cordis/lib/index.js', 'dsh-session/lib/index.js', 'dsh-session-projection/lib/index.js', 'dsh-agent/lib/index.js',
    'dsh-agent-loop/lib/index.js', 'dsh-system-prompt/lib/index.js', 'dsh-tools/lib/index.js', 'dsh-workflow-ptc/lib/index.js',
  ].map(load));
  const ctx = new Context();
  let handle;
  try {
    await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry); await ctx.plugin(AgentRegistry);
    await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); ctx.provide('llm', {});
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 10 });
    handle = await ctx.agents.create({ sessionId: 'synthetic-only-agent' });
    const agent = handle.agent;
    assert.deepEqual(descriptor(agent, 'session'), { level: 0, kind: 'data' });
    assert.deepEqual(descriptor(agent.session, 'id'), { level: 1, kind: 'accessor' });
    ctx.provide('subagents', { getProvider() { return {}; } });
    ctx.provide('sandboxPolicy', { resolve() { return { mode: 'danger-full-access' }; } });
    ctx.provide('workingDirectory', { ensure() { return Promise.resolve('/synthetic'); } });
    let runtimeCalls = 0;
    ctx.provide('ptcRuntime', { language: 'typescript', programFormat: 'module', resolve(input) { return input; }, run() {
      runtimeCalls++; return Promise.resolve({ value: { value: null, stopReason: 'completed', agentsStarted: 0 } });
    } });
    await ctx.plugin(PtcWorkflowEngine, { provider: 'fake', maxConcurrentAgents: 1, maxTotalAgents: 10, maxItemsPerCall: 10, syncTimeoutMs: 500 });
    const probe = ctx.workflowEngine.start({ script: 'return 1;', meta: { name: 'probe', description: 'synthetic' }, parent: agent });
    assert.deepEqual(descriptor(probe, 'id'), { level: 0, kind: 'data' });
    await probe.result; await probe.dispose();
    runtimeCalls = 0;
    let info;
    ctx.on('workflow/start', (value) => { info = value; });
    apply(ctx, { toolName: 'synthetic-workflow', enableRunInBackground: true, maxResultChars: 1000 });
    const result = await ctx.tools.execute({ name: 'synthetic-workflow', callId: 'synthetic-call', agent,
      arguments: { script: 'return 1;', meta: { name: 'fixture', description: 'synthetic' } }, signal: new AbortController().signal });
    assert.equal(result.isError, false);
    assert.equal(runtimeCalls, 1); // inert stub: never runs script or model
    assert.equal(info.id, result.value.runId);
    assert.deepEqual(candidatesFor(ctx), []); // safe own-data reader cannot derive the real Session's prototype id
    const events = agent.session.snapshotEvents();
    assert.deepEqual(events.filter((event) => event.type.startsWith('tool-workflow/')).map((event) => event.type), ['tool-workflow/run-start', 'tool-workflow/run-end']);
  } finally { await handle?.dispose(); await ctx.fiber.dispose(); }
});

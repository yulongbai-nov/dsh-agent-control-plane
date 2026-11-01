import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAgentSpec } from '../index.mjs';

function check(backend, spec) {
  const result = checkAgentSpec(backend, spec);
  assert.ok(Array.isArray(result.findings));
  assert.ok(result.findings.every(item => ['reject', 'unknown'].includes(item.level) && typeof item.code === 'string'));
  return result;
}
function has(result, code) { return result.findings.some(finding => finding.code === code); }

test('spawn statically accepts the documented subset without claiming runtime approval', () => {
  const result = check('spawn', { preset: 'standard', overrides: { provider: 'codex', model: 'example-model', reasoningEffort: 'high', maxTokens: 2048 } });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.approved, { agentPreset: 'standard', agentOptions: { provider: 'codex', model: 'example-model', reasoningEffort: 'high', maxTokens: 2048 } });
  assert.ok(has(result, 'RUNTIME_NOT_VERIFIED'));
  assert.ok(has(result, 'DELEGATION_POLICY_UNKNOWN'));
});

test('fork can accept options but must reject independent preset selection', () => {
  const result = check('fork', { preset: 'standard', overrides: { provider: 'x' } });
  assert.equal(result.status, 'reject');
  assert.ok(has(result, 'UNSUPPORTED_AGENT_PRESET'));
  assert.equal('approved' in result, false);
  const allowed = check('fork', { overrides: { provider: 'x', model: 'y' } });
  assert.equal(allowed.status, 'unknown');
  assert.deepEqual(allowed.approved, { agentOptions: { provider: 'x', model: 'y' } });
});

test('external native backends reject even empty agentOptions or a preset', () => {
  for (const backend of ['codex', 'claude-code', 'acp']) {
    for (const spec of [{ overrides: {} }, { overrides: { model: 'x' } }, { preset: 'standard' }]) {
      const result = check(backend, spec);
      assert.equal(result.status, 'reject', backend);
      assert.equal('approved' in result, false);
    }
    const empty = check(backend, {});
    assert.equal(empty.status, 'unknown');
    assert.deepEqual(empty.approved, {});
    assert.ok(has(empty, 'DELEGATION_POLICY_UNKNOWN'));
  }
});

test('unknown backend or omitted spec cannot claim accepted or silently drop fields', () => {
  for (const backend of ['custom', '', null, undefined, 1]) {
    const result = check(backend, { overrides: { provider: 'x' } });
    assert.equal(result.status, 'unknown');
    assert.ok(has(result, 'UNKNOWN_BACKEND'));
    assert.equal('approved' in result, false);
  }
  for (const spec of [null, undefined, [], 'x', 1]) {
    const result = check('spawn', spec);
    assert.equal(result.status, 'reject');
    assert.equal('approved' in result, false);
  }
});

test('rejects unsupported, unknown, misspelled and runtime-owned fields', () => {
  for (const spec of [
    { overrides: { subagentDepth: 0 } },
    { overrides: { subagentDepth: 2 } },
    { overrides: { model: 'x', typo: true } },
    { overrides: { reasoning_effort: 'max' } },
    { role: 'researcher' }, { persistence: 'durable' }, { schema: {} }, { nonsense: 1 },
    { preset: undefined }, { overrides: undefined }, { overrides: { provider: undefined } },
  ]) {
    const result = check('spawn', spec);
    assert.equal(result.status, 'reject', JSON.stringify(spec));
    assert.equal('approved' in result, false);
  }
});

test('rejects malformed values without inventing effort or route support', () => {
  for (const spec of [
    { preset: '' }, { preset: 2 }, { preset: null },
    { overrides: null }, { overrides: [] }, { overrides: 'x' },
    ...['provider', 'model', 'reasoningEffort'].flatMap(key => [null, 1, '', false].map(value => ({ overrides: { [key]: value } }))),
    ...[0, -1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1, '1'].map(maxTokens => ({ overrides: { maxTokens } })),
  ]) {
    const result = check('spawn', spec);
    assert.equal(result.status, 'reject');
    assert.equal('approved' in result, false);
  }
  for (const maxTokens of [1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(check('spawn', { overrides: { maxTokens } }).status, 'unknown');
  }
  assert.equal(check('spawn', { overrides: { reasoningEffort: 'adapter-defined-id' } }).status, 'unknown');
});

test('object-access failures and unknown nested keys cannot smuggle accepted fields', () => {
  for (const override of [
    Object.assign(Object.create(null), { unknown: 1 }),
    { maxTokens: -0 },
    Object.assign(Object.create({ model: 'inherited' }), { provider: 'real' }),
    Object.defineProperty({}, Symbol('hidden'), { value: 1 }),
    new Proxy({}, { ownKeys() { throw new Error('private'); } }),
  ]) {
    const result = check('spawn', { overrides: override });
    assert.equal(result.status, 'reject');
    assert.equal('approved' in result, false);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('candidate input values are detached and only read once', () => {
  let count = 0;
  const overrides = {};
  Object.defineProperty(overrides, 'model', { enumerable: true, get() { return ++count === 1 ? 'first' : ''; } });
  const spec = { overrides };
  const result = check('spawn', spec);
  assert.equal(result.status, 'unknown');
  assert.equal(count, 1);
  overrides.newUnknown = 'value';
  assert.deepEqual(result.approved, { agentOptions: { model: 'first' } });
});

test('dangerous or throwing property access never produces an approved payload', () => {
  const bad = Object.defineProperty({}, 'preset', { enumerable: true, get() { throw new Error('private'); } });
  const result = check('spawn', bad);
  assert.equal(result.status, 'reject');
  assert.equal('approved' in result, false);
  assert.equal(JSON.stringify(result).includes('private'), false);
  const symbol = Symbol('unknown');
  assert.equal(check('spawn', { [symbol]: 1 }).status, 'reject');
  const customProto = Object.create({ overrides: { provider: 'hidden' } });
  assert.equal(check('spawn', customProto).status, 'reject');
});

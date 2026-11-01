'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReceipt, createModel, requiredProvenance } = require('../index.cjs');

const scope = (overrides = {}) => ({ kind: 'scope', workspaceId: 'fixture-w1', sessionId: 'fixture-s1', ...overrides });
const origin = (overrides = {}) => ({ kind: 'origin', workspaceId: 'fixture-w1', sessionId: 'fixture-s1', generationId: 'fixture-g1', eventSeq: 1, callId: 'fixture-call1', sourceTag: 'synthetic-source-a', ...overrides });
const attempt = (overrides = {}) => ({ kind: 'attempt', workspaceId: 'fixture-w1', sessionId: 'fixture-s1', generationId: 'fixture-g1', eventSeq: 1, callId: 'fixture-call1', attemptId: 'fixture-attempt1', definitionId: 'fixture-definition1', effectiveSourceTag: 'synthetic-source-b', ...overrides });
const accepted = (overrides = {}) => ({ kind: 'accepted', workspaceId: 'fixture-w1', sessionId: 'fixture-s1', attemptId: 'fixture-attempt1', runId: 'fixture-run1', sourceTag: 'synthetic-source-c', ...overrides });
const lifecycle = (overrides = {}) => ({ kind: 'lifecycle', workspaceId: 'fixture-w1', sessionId: 'fixture-s1', runId: 'fixture-run1', phase: 'start', ...overrides });
const complete = () => [scope(), origin(), attempt(), accepted(), lifecycle(), lifecycle({ phase: 'end', outcome: 'completed' })];
const findAttempt = (snapshot, id = 'fixture-attempt1') => snapshot.scopes[0].attempts.find((entry) => entry.attemptId === id);
const hasCode = (error, code) => error && error.code === code && error.message === code;
function ingest(items) { const model = createModel(); for (const item of items) model.observe(item); return model.read(); }
function isDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

test('validator accepts only strict bounded fixture records and detaches', () => {
  for (const sample of complete()) {
    const result = validateReceipt(sample);
    assert.deepEqual(result, sample);
    assert.notStrictEqual(result, sample);
    assert.ok(isDeepFrozen(result));
  }
});

test('validator rejects proxy, getter, prototype and unknown fields without reading them', () => {
  let touched = 0;
  const getter = origin();
  Object.defineProperty(getter, 'sourceTag', { enumerable: true, get() { touched++; throw Error('secret'); } });
  const proxy = new Proxy(origin(), { ownKeys() { touched++; throw Error('secret'); } });
  const inherited = Object.assign(Object.create({ sourceTag: 'synthetic-source-a' }), origin());
  const { proxy: revoked, revoke } = Proxy.revocable(origin(), {});
  revoke();
  for (const value of [getter, proxy, revoked, inherited, { ...origin(), source: 'private-secret' }, null, []]) {
    assert.throws(() => validateReceipt(value), (error) => hasCode(error, 'INVALID_RECEIPT'));
  }
  assert.equal(touched, 0);
});

test('validator rejects unbounded fields, non-fixture values, invalid numbers and tags', () => {
  const samples = [
    origin({ workspaceId: 'private-secret' }), origin({ workspaceId: 'fixture-' + 'x'.repeat(100) }),
    origin({ sourceTag: 'return secret;' }), origin({ eventSeq: -0 }), origin({ eventSeq: -1 }),
    origin({ eventSeq: Number.MAX_SAFE_INTEGER + 1 }), attempt({ effectiveSourceTag: 'synthetic-source-d' }),
    lifecycle({ phase: 'end' }), lifecycle({ phase: 'start', outcome: 'completed' }),
    lifecycle({ phase: 'end', outcome: 'secret' }), { ...scope(), kind: 'source-cut' },
    { ...scope(), kind: 'job' }, { ...scope(), trusted: true },
  ];
  for (const sample of samples) assert.throws(() => validateReceipt(sample), (error) => hasCode(error, 'INVALID_RECEIPT'));
});

test('required-provenance is unsupported regardless of caller claims', () => {
  assert.deepEqual(requiredProvenance(), { status: 'unsupported' });
  assert.deepEqual(requiredProvenance({ trusted: true, verified: true }), { status: 'unsupported' });
  assert.deepEqual(requiredProvenance(new Proxy({}, { get() { throw Error('should not touch'); } })), { status: 'unsupported' });
});

test('a structurally complete synthetic chain is detached, immutable and never verified', () => {
  const receipts = complete();
  const model = createModel();
  for (const receipt of receipts) model.observe(receipt);
  const snapshot = model.read();
  assert.ok(isDeepFrozen(snapshot));
  assert.equal(snapshot.mode, 'synthetic-only');
  assert.equal(snapshot.sourceCoverage, 'unknown');
  assert.equal(snapshot.jobOwnership, 'unknown');
  assert.equal(snapshot.scopes[0].relation, 'consistent');
  assert.equal(findAttempt(snapshot).relation, 'consistent');
  assert.deepEqual(findAttempt(snapshot).sources, { original: 'synthetic-source-a', effective: 'synthetic-source-b', accepted: 'synthetic-source-c' });
  assert.equal(findAttempt(snapshot).lifecycle, 'unknown');
  assert.equal(findAttempt(snapshot).observedEnd, 'completed');
  assert.doesNotMatch(JSON.stringify(snapshot), /verified|trusted/);
  receipts[2].definitionId = 'fixture-changed';
  assert.deepEqual(model.read(), snapshot);
});

test('arbitrary receipt arrival order does not infer chronology', () => {
  const expected = ingest(complete());
  assert.deepEqual(ingest([...complete()].reverse()), expected);
  const l = ingest([scope(), lifecycle({ phase: 'end', outcome: 'completed' })]);
  assert.equal(l.scopes[0].runs[0].lifecycle, 'unknown');
  assert.equal(l.scopes[0].runs[0].relation, 'incomplete');
});

test('identical replay is idempotent and does not consume capacity', () => {
  const model = createModel({ maxReceipts: 1 });
  const first = model.observe(scope());
  for (let i = 0; i < 150; i++) assert.deepEqual(model.observe(scope()), first);
  assert.throws(() => model.observe(origin()), (error) => hasCode(error, 'LIMIT'));
  assert.equal(model.read().state, 'overflow');
  assert.deepEqual(model.read().scopes, []);
});

test('same-key conflict permanently quarantines association despite later replay', () => {
  const model = createModel();
  for (const receipt of complete()) model.observe(receipt);
  model.observe(attempt({ definitionId: 'fixture-definition2' }));
  const conflict = model.read();
  assert.equal(findAttempt(conflict).relation, 'conflict');
  assert.equal(findAttempt(conflict).lifecycle, 'unknown');
  assert.ok(conflict.diagnostics.includes('SAME_KEY_CONFLICT'));
  model.observe(attempt());
  assert.deepEqual(model.read(), conflict);
});

test('typed refs distinguish source generation and do not join across scope', () => {
  const snapshot = ingest([
    scope(), scope({ sessionId: 'fixture-s2' }), origin(),
    attempt({ generationId: 'fixture-g2' }),
    accepted({ sessionId: 'fixture-s2' }),
  ]);
  const first = snapshot.scopes.find((entry) => entry.sessionId === 'fixture-s1');
  const second = snapshot.scopes.find((entry) => entry.sessionId === 'fixture-s2');
  assert.equal(first.attempts[0].relation, 'conflict');
  assert.equal(second.runs[0].relation, 'conflict');
  assert.ok(snapshot.diagnostics.includes('CROSS_SCOPE_ID_CONFLICT'));
});

test('zero, one and two attempts per origin remain distinct', () => {
  const zero = ingest([scope(), origin()]);
  assert.equal(zero.scopes[0].origins[0].attempts, 0);
  const two = ingest([scope(), origin(), attempt(), attempt({ attemptId: 'fixture-attempt2', definitionId: 'fixture-definition2' })]);
  assert.equal(two.scopes[0].origins[0].attempts, 2);
  assert.equal(two.scopes[0].attempts.length, 2);
  assert.ok(two.scopes[0].attempts.every((item) => item.relation === 'incomplete'));
});

test('distinct attempts claiming the same run quarantine both, not last-wins', () => {
  const snapshot = ingest([...complete(), attempt({ attemptId: 'fixture-attempt2' }), accepted({ attemptId: 'fixture-attempt2' })]);
  assert.equal(findAttempt(snapshot).relation, 'conflict');
  assert.equal(findAttempt(snapshot, 'fixture-attempt2').relation, 'conflict');
  assert.equal(snapshot.scopes[0].runs[0].lifecycle, 'unknown');
  assert.ok(snapshot.diagnostics.includes('RUN_OWNERSHIP_CONFLICT'));
});

test('same event key with different call and same attempt key with different origin are quarantined', () => {
  const eventConflict = ingest([...complete(), origin({ callId: 'fixture-call2' })]);
  assert.equal(findAttempt(eventConflict).relation, 'conflict');
  const attemptConflict = ingest([...complete(), attempt({ eventSeq: 2, callId: 'fixture-call2' })]);
  assert.equal(findAttempt(attemptConflict).relation, 'conflict');
});

test('a missing scope, origin or accepted edge remains incomplete', () => {
  for (const missing of ['scope', 'origin', 'accepted']) {
    const snapshot = ingest(complete().filter((item) => item.kind !== missing));
    assert.equal(findAttempt(snapshot).relation, 'incomplete', missing);
  }
});

test('lifecycle end without start is unknown; contradictory terminal outcomes quarantine', () => {
  const orphan = ingest([scope(), origin(), attempt(), accepted(), lifecycle({ phase: 'end', outcome: 'completed' })]);
  assert.equal(findAttempt(orphan).lifecycle, 'unknown');
  const conflict = ingest([...complete(), lifecycle({ phase: 'end', outcome: 'cancelled' })]);
  assert.equal(findAttempt(conflict).lifecycle, 'unknown');
  assert.equal(conflict.scopes[0].runs[0].relation, 'conflict');
});

test('receipt cap is global across kinds and invalid data does not enter snapshots', () => {
  const model = createModel({ maxReceipts: 2 });
  model.observe(scope()); model.observe(origin());
  const before = model.read();
  assert.throws(() => model.observe({ ...origin(), sourceTag: 'private-secret' }), (error) => hasCode(error, 'INVALID_RECEIPT'));
  assert.deepEqual(model.read(), before);
  assert.throws(() => model.observe(attempt()), (error) => hasCode(error, 'LIMIT'));
  assert.equal(model.read().state, 'overflow');
  assert.doesNotMatch(JSON.stringify(model.read()), /private-secret/);
});

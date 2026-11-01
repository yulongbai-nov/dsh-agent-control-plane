'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReceipt, createModel } = require('../index.cjs');
const s = { kind: 'scope', workspaceId: 'fixture-w1', sessionId: 'fixture-s1' };
const o = { ...s, kind: 'origin', generationId: 'fixture-g1', eventSeq: 1, callId: 'fixture-c1', sourceTag: 'synthetic-source-a' };
const a = { ...s, kind: 'attempt', generationId: 'fixture-g1', eventSeq: 1, callId: 'fixture-c1', attemptId: 'fixture-a1', definitionId: 'fixture-d1', effectiveSourceTag: 'synthetic-source-b' };
const accepted = { ...s, kind: 'accepted', attemptId: 'fixture-a1', runId: 'fixture-r1', sourceTag: 'synthetic-source-c' };
const start = { ...s, kind: 'lifecycle', runId: 'fixture-r1', phase: 'start' };
const end = { ...s, kind: 'lifecycle', runId: 'fixture-r1', phase: 'end', outcome: 'completed' };
const base = [s, o, a, accepted, start, end];
function fold(receipts, options) { const m = createModel(options); for (const r of receipts) m.observe(r); return m; }
const attempt = (m) => m.read().scopes[0].attempts[0];
const run = (m) => m.read().scopes[0].runs.find((r) => r.runId === 'fixture-r1');
const code = (expected) => (error) => error?.message === expected && error?.code === expected;

test('origin and attempt conflicts quarantine downstream runs and suppress lifecycle', () => {
  for (const bad of [{ ...o, sourceTag: 'synthetic-source-b' }, { ...a, definitionId: 'fixture-d2' }]) {
    const m = fold([...base, bad]);
    assert.equal(attempt(m).relation, 'conflict');
    assert.equal(attempt(m).lifecycle, 'unknown');
    assert.equal(run(m).relation, 'conflict');
    assert.equal(run(m).lifecycle, 'unknown');
  }
});

test('scope stays incomplete for missing origin, even when run and lifecycle exist', () => {
  const m = fold([s, a, accepted, start, end]);
  assert.equal(attempt(m).relation, 'incomplete');
  assert.equal(attempt(m).lifecycle, 'unknown');
  assert.equal(run(m).relation, 'incomplete');
  assert.equal(run(m).lifecycle, 'unknown');
});

test('run claims sharing a conflicted attempt also quarantine other owners', () => {
  const second = { ...a, attemptId: 'fixture-a2' };
  const m = fold([...base, second, { ...accepted, runId: 'fixture-r2' }, { ...accepted, attemptId: 'fixture-a2', runId: 'fixture-r2' }]);
  assert.equal(m.read().scopes[0].attempts.find((v) => v.attemptId === 'fixture-a2').relation, 'conflict');
});

test('same call cannot occupy different event references in one scope and generation', () => {
  const m = fold([...base, { ...o, eventSeq: 2 }]);
  assert.equal(attempt(m).relation, 'conflict');
  assert.equal(run(m).relation, 'conflict');
  assert.ok(m.read().diagnostics.includes('CALL_ORIGIN_CONFLICT'));
});

test('attempt and run identity reuse across scopes quarantines both, regardless of arrival', () => {
  for (const kind of ['attempt', 'run']) {
    const otherScope = { workspaceId: 'fixture-w2', sessionId: 'fixture-s2' };
    const other = kind === 'attempt' ? { ...a, ...otherScope } : { ...start, ...otherScope };
    const items = [...base, { ...s, ...otherScope }, other];
    const forward = fold(items).read();
    const reverse = fold([...items].reverse()).read();
    assert.deepEqual(reverse, forward);
    assert.equal(forward.scopes[0].attempts[0].relation, 'conflict');
    assert.equal(forward.scopes[0].runs[0].lifecycle, 'unknown');
    assert.ok(forward.diagnostics.includes('CROSS_SCOPE_ID_CONFLICT'));
  }
});

test('missing or mismatched origin call never yields a consistent run or lifecycle', () => {
  const m = fold([s, o, { ...a, callId: 'fixture-c2' }, accepted, start, end]);
  assert.equal(attempt(m).relation, 'incomplete');
  assert.equal(attempt(m).lifecycle, 'unknown');
  assert.equal(attempt(m).observedEnd, null);
  assert.equal(run(m).relation, 'incomplete');
  assert.equal(run(m).lifecycle, 'unknown');
});

test('empty scope and origin-only input are structurally incomplete', () => {
  assert.equal(fold([s]).read().scopes[0].relation, 'incomplete');
  const snapshot = fold([s, o]).read();
  assert.equal(snapshot.scopes[0].relation, 'incomplete');
  assert.equal(snapshot.scopes[0].origins[0].relation, 'incomplete');
  assert.equal(snapshot.scopes[0].origins[0].attempts, 0);
});

test('independent origin without observed attempt keeps its scope incomplete', () => {
  const other = { ...o, eventSeq: 2, callId: 'fixture-c2' };
  const receipts = [...base, other];
  const forward = fold(receipts).read();
  const reverse = fold([...receipts].reverse()).read();
  assert.deepEqual(reverse, forward);
  assert.equal(forward.scopes[0].relation, 'incomplete');
  assert.deepEqual(forward.scopes[0].origins.map((v) => [v.eventSeq, v.attempts, v.relation]), [
    [1, 1, 'consistent'], [2, 0, 'incomplete'],
  ]);
  assert.equal(forward.scopes[0].attempts[0].relation, 'consistent');
});

test('another origin needs its own matching accepted edge to complete the scope', () => {
  const other = { ...o, eventSeq: 2, callId: 'fixture-c2' };
  const second = { ...a, eventSeq: 2, callId: 'fixture-c2', attemptId: 'fixture-a2' };
  const model = fold([...base, other]);
  assert.equal(model.read().scopes[0].relation, 'incomplete');
  model.observe(second);
  assert.equal(model.read().scopes[0].relation, 'incomplete');
  model.observe({ ...accepted, attemptId: 'fixture-a2', runId: 'fixture-r2' });
  assert.equal(model.read().scopes[0].relation, 'consistent');
  assert.equal(model.read().sourceCoverage, 'unknown');
});

test('same session id in different workspaces remains distinct without join or collision', () => {
  const other = { workspaceId: 'fixture-w2', sessionId: 'fixture-s1' };
  const first = base;
  const second = [
    { ...s, ...other }, { ...o, ...other },
    { ...a, ...other, attemptId: 'fixture-a2' },
    { ...accepted, ...other, attemptId: 'fixture-a2', runId: 'fixture-r2' },
  ];
  const snapshot = fold([...first, ...second]).read();
  assert.equal(snapshot.scopes.length, 2);
  assert.deepEqual(snapshot.scopes.map((entry) => [entry.workspaceId, entry.sessionId, entry.relation]), [
    ['fixture-w1', 'fixture-s1', 'consistent'], ['fixture-w2', 'fixture-s1', 'consistent'],
  ]);
  assert.deepEqual(snapshot.scopes.map((entry) => entry.attempts.map((v) => v.attemptId)), [['fixture-a1'], ['fixture-a2']]);
  assert.equal(snapshot.diagnostics.includes('CROSS_SCOPE_ID_CONFLICT'), false);
  const incomplete = fold([...first, ...second.filter((v) => v.kind !== 'origin')]).read();
  assert.equal(incomplete.scopes[0].relation, 'consistent');
  assert.equal(incomplete.scopes[1].relation, 'incomplete');
  assert.equal(incomplete.scopes[1].attempts[0].sources.original, null);
  for (const kind of ['attempt', 'run']) {
    const duplicate = kind === 'attempt' ? { ...a, ...other } : { ...start, ...other };
    const quarantined = fold([...first, { ...s, ...other }, duplicate]).read();
    assert.equal(quarantined.scopes[0].relation, 'conflict');
    assert.ok(quarantined.diagnostics.includes('CROSS_SCOPE_ID_CONFLICT'));
  }
});

test('a valid record without scope never reports a consistent run or lifecycle', () => {
  const m = fold(base.filter((r) => r.kind !== 'scope'));
  assert.equal(attempt(m).relation, 'incomplete');
  assert.equal(attempt(m).lifecycle, 'unknown');
  assert.equal(run(m).relation, 'incomplete');
  assert.equal(run(m).lifecycle, 'unknown');
});

test('resource cap detects conflicts without storing new claimant and remains quarantined', () => {
  const m = fold(base, { maxReceipts: base.length });
  const before = m.read();
  assert.equal(attempt(m).relation, 'consistent');
  assert.throws(() => m.observe({ ...a, definitionId: 'fixture-d2' }), code('LIMIT'));
  const after = m.read();
  assert.equal(after.state, 'overflow');
  assert.equal(after.scopes.length, 0);
  assert.equal(after.sourceCoverage, 'unknown');
  assert.throws(() => m.observe(a), code('LIMIT'));
  assert.deepEqual(m.read(), after);
});

test('old immutable snapshots remain historical after later conflict and overflow', () => {
  const conflict = fold(base);
  const beforeConflict = conflict.read();
  conflict.observe({ ...a, definitionId: 'fixture-d2' });
  assert.equal(beforeConflict.scopes[0].relation, 'consistent');
  assert.equal(conflict.read().scopes[0].relation, 'conflict');

  const limited = fold(base, { maxReceipts: base.length });
  const beforeOverflow = limited.read();
  assert.throws(() => limited.observe({ ...a, definitionId: 'fixture-d2' }), code('LIMIT'));
  assert.equal(beforeOverflow.scopes[0].relation, 'consistent');
  assert.equal(limited.read().state, 'overflow');
  assert.ok(Object.isFrozen(beforeConflict));
  assert.ok(Object.isFrozen(beforeOverflow));
});

test('invalid object source tag never enters caller-provided coercion', () => {
  let calls = 0;
  const bad = { [Symbol.toPrimitive]() { calls++; throw Error('secret'); } };
  assert.throws(() => validateReceipt({ ...o, sourceTag: bad }), code('INVALID_RECEIPT'));
  assert.equal(calls, 0);
});

test('start/end claims without typed event sequence never prove chronological lifecycle', () => {
  const forward = fold(base).read();
  const reverse = fold([...base].reverse()).read();
  assert.deepEqual(reverse, forward);
  assert.equal(forward.scopes[0].runs[0].lifecycle, 'unknown');
  assert.equal(forward.scopes[0].runs[0].observedEnd, 'completed');
  assert.equal(forward.scopes[0].attempts[0].lifecycle, 'unknown');
});

test('validation failures leave state unchanged; output, error do not echo raw data', () => {
  const m = fold(base);
  const prior = m.read();
  assert.throws(() => m.observe({ ...a, callId: 'secret-data' }), code('INVALID_RECEIPT'));
  assert.deepEqual(m.read(), prior);
  assert.doesNotMatch(JSON.stringify(m.read()), /secret-data/);
});

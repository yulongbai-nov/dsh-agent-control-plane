import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollector, snapshotMeta } from '../observation.mjs';

const publishCandidate = (store, candidate) => {
  const meta = snapshotMeta(candidate.request.meta);
  store.publish({ ...candidate, request: { script: candidate.request.script, meta } });
};

test('publishes a detached, explicitly unverified effective request candidate', async () => {
  const store = createCollector();
  const request = { script: 'return 1;', meta: { name: 'fixture', phases: [{ title: 'test' }] }, args: { input: 1 } };
  publishCandidate(store, { sessionId: 'session', callId: 'call', rootCallId: 'call', runId: 'run', kind: 'foreground', request });
  request.meta.phases[0].title = 'mutated';
  const [record] = store.snapshot();
  assert.equal(record.status, 'unverified');
  assert.deepEqual([record.sessionId, record.callId, record.rootCallId, record.runId, record.kind, record.script], ['session', 'call', 'call', 'run', 'foreground', 'return 1;']);
  assert.equal(record.meta.name, 'fixture');
  assert.equal(record.meta.phases[0].title, 'test');
});

test('does not read getters, cycles, prototypes or retain unsafe input', async () => {
  let reads = 0;
  const trap = { get title() { reads++; return 'unsafe'; } };
  const cycle = {}; cycle.self = cycle;
  for (const value of [trap, cycle, new Date(), Object.create({ inherited: true })]) {
    const store = createCollector();
    publishCandidate(store, { sessionId: 's', callId: 'c', rootCallId: 'c', runId: 'r', kind: 'foreground', request: { script: 'return 1', meta: value } });
    await Promise.resolve();
    assert.deepEqual(store.snapshot(), []);
  }
  assert.equal(reads, 0);
});

test('rejects oversized or sparse arrays without JSON stringify expansion', () => {
  const huge = []; huge.length = 0xffffffff;
  const sparse = []; sparse.length = 16; sparse[15] = { title: 'last' };
  const custom = [{ title: 'a' }]; custom.extra = 'unexpected';
  assert.equal(snapshotMeta({ phases: huge }), undefined);
  assert.equal(snapshotMeta({ phases: sparse }), undefined);
  assert.equal(snapshotMeta({ phases: custom }), undefined);
});

test('does not invoke inherited toJSON during metadata or candidate cloning', () => {
  const store = createCollector();
  let called = 0;
  Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { called++; throw new Error('must not execute'); } });
  Object.defineProperty(Array.prototype, 'toJSON', { configurable: true, value() { called++; throw new Error('must not execute'); } });
  try {
    const meta = snapshotMeta({ phases: [{ title: 'one' }] });
    assert.equal(called, 0);
    store.publish({ sessionId: 's', callId: 'c', rootCallId: 'c', runId: 'r', kind: 'foreground', request: { script: 'return 1;', meta } });
    const result = store.snapshot();
    assert.equal(result.length, 1);
    assert.equal(called, 0);
  } finally { delete Object.prototype.toJSON; delete Array.prototype.toJSON; }
});

test('shared references are copied independently; cycles, non-finite numbers and -0 are refused', () => {
  const child = { title: 'shared' };
  const meta = snapshotMeta({ phases: [child, child] });
  assert.equal(meta.phases[0].title, meta.phases[1].title);
  assert.notEqual(meta.phases[0], meta.phases[1]);
  assert.equal(snapshotMeta({ value: -0 }), undefined);
  assert.equal(snapshotMeta({ value: Infinity }), undefined);
  assert.equal(snapshotMeta({ value: NaN }), undefined);
});

test('collector bounds total retained script plus metadata and recovers after clear', () => {
  const store = createCollector();
  const candidate = { sessionId: 's', callId: 'c', rootCallId: 'c', runId: 'r', kind: 'foreground', request: { script: 'x'.repeat(900_000), meta: {} } };
  for (let i = 0; i < 4; i++) publishCandidate(store, candidate);
  assert.equal(store.snapshot().length, 2);
  store.clear();
  publishCandidate(store, candidate);
  assert.equal(store.snapshot().length, 1);
});

test('refuses symbol, custom and accessor array properties without reading them', () => {
  let reads = 0;
  const getter = [1];
  Object.defineProperty(getter, '0', { enumerable: true, get() { reads++; return 1; } });
  const symbol = [1]; symbol[Symbol('extra')] = 'x';
  const extra = [1]; extra.extra = 'x';
  const toJSON = [1]; toJSON.toJSON = () => 1;
  for (const value of [getter, symbol, extra, toJSON]) assert.equal(snapshotMeta({ value }), undefined);
  assert.equal(reads, 0);
});

test('refuses Proxies without invoking proxy traps', () => {
  let calls = 0;
  const proxy = new Proxy({}, { ownKeys() { calls++; throw new Error('trap'); } });
  assert.equal(snapshotMeta(proxy), undefined);
  assert.equal(calls, 0);
});

test('dispose permanently drops late candidate publication', () => {
  const store = createCollector();
  const candidate = { sessionId: 's', callId: 'c', rootCallId: 'c', runId: 'r', kind: 'foreground', request: { script: 'return 1;', meta: {} } };
  publishCandidate(store, candidate);
  store.dispose();
  publishCandidate(store, candidate);
  assert.deepEqual(store.snapshot(), []);
});

test('enforces text bounds and clears all retained candidates', async () => {
  const store = createCollector();
  publishCandidate(store, { sessionId: 's', callId: 'c', rootCallId: 'c', runId: 'r', kind: 'foreground', request: { script: 'x'.repeat(1_000_001), meta: {} } });
  publishCandidate(store, { sessionId: 's', callId: 'c', rootCallId: 'c', runId: 'r', kind: 'foreground', request: { script: 'x', meta: {} } });
  store.clear();
  await Promise.resolve();
  assert.deepEqual(store.snapshot(), []);
});

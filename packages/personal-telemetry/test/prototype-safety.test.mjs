import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../index.mjs';

const KEY = 'a'.repeat(64), OTHER = 'b'.repeat(64), SOURCE = 'c'.repeat(64);
const tokenUsage = () => ({ uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 });
const sessionStats = () => ({ turns: 1, steps: 2, llmMs: 3, toolMs: 4, ttftMs: 5, ttftSteps: 6, decodeMs: 7, decodeTokens: 8 });
const request = (sessionKey = KEY) => ({
  sessionKey, sourceIdentity: SOURCE,
  snapshot: { kind: 'sequenced', asOfSeq: 10, values: { tokenUsage: tokenUsage(), sessionStats: sessionStats() } }
});

// This file runs in its own node:test process. Each synchronous probe restores
// the original descriptor before making assertions or returning to the harness.
function restorePrototype(field, descriptor) {
  if (descriptor) Object.defineProperty(Object.prototype, field, descriptor);
  else delete Object.prototype[field];
}

for (const [unit, field] of [
  ...Object.keys(tokenUsage()).map(field => ['tokenUsage', field]),
  ...Object.keys(sessionStats()).map(field => ['sessionStats', field])
]) {
  test(`validated ${unit}.${field} is not changed by an inherited setter`, () => {
    const store = createMemoryStore(), input = request(), expected = input.snapshot.values[unit][field];
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, field);
    let calls = 0, status, row;
    try {
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        set() {
          calls++;
          Object.defineProperty(this, field, { value: 999, configurable: true, enumerable: true, writable: true });
        }
      });
      status = store.ingest(input);
      row = store.get(KEY);
    } finally {
      restorePrototype(field, descriptor);
      store.close();
    }
    assert.equal(status, 'inserted');
    assert.equal(calls, 0, 'normalizing input must not invoke the inherited setter');
    assert.equal(row[unit][field], expected);
    assert.equal(Object.getPrototypeOf(row[unit]), Object.prototype, 'public result remains an ordinary object');
  });
}

test('a later unit getter cannot mutate or acquire the earlier validated unit', () => {
  const store = createMemoryStore(), input = request(), field = 'uncachedInputTokens';
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, field);
  let leaked, calls = 0, status, row;
  Object.defineProperty(input.snapshot.values.tokenUsage, field, { enumerable: true, get() {
    Object.defineProperty(Object.prototype, field, {
      configurable: true,
      set(value) {
        calls++;
        leaked = this;
        Object.defineProperty(this, field, { value, configurable: true, enumerable: true, writable: true });
      }
    });
    return 10;
  } });
  Object.defineProperty(input.snapshot.values.sessionStats, 'turns', { enumerable: true, get() {
    if (leaked) leaked[field] = 777;
    return 1;
  } });
  try {
    status = store.ingest(input);
    row = store.get(KEY);
  } finally {
    restorePrototype(field, descriptor);
    store.close();
  }
  assert.equal(status, 'inserted');
  assert.equal(calls, 0);
  assert.equal(leaked, undefined);
  assert.equal(row.tokenUsage[field], 10);
});

test('a setter cannot hide a same-sequence conflict and commit an earlier batch row', () => {
  const store = createMemoryStore(), conflict = request(), field = 'outputTokens';
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, field);
  let calls = 0, error, before, after, other;
  try {
    store.ingest(request());
    before = store.get(KEY);
    Object.defineProperty(conflict.snapshot.values.tokenUsage, field, { enumerable: true, get() {
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        set() {
          calls++;
          Object.defineProperty(this, field, { value: 2, configurable: true, enumerable: true, writable: true });
        }
      });
      return 99;
    } });
    try { store.ingestBatch([request(OTHER), conflict]); } catch (caught) { error = caught; }
  } finally {
    restorePrototype(field, descriptor);
    after = store.get(KEY);
    other = store.get(OTHER);
    store.close();
  }
  assert.equal(error?.code, 'SEQUENCE_CONFLICT');
  assert.equal(calls, 0);
  assert.deepEqual(after, before);
  assert.equal(other, null);
});

for (const selected of ['tokenUsage', 'sessionStats']) {
  test(`inherited toJSON cannot change an identical ${selected} into a conflict`, () => {
    const store = createMemoryStore(), input = request(), descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    let calls = 0, status, row;
    try {
      store.ingest(request());
      const unit = input.snapshot.values[selected];
      Object.defineProperty(input.snapshot.values, selected, { enumerable: true, get() {
        Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { calls++; return 0; } });
        return unit;
      } });
      status = store.ingest(input);
      row = store.get(KEY);
    } finally {
      restorePrototype('toJSON', descriptor);
      store.close();
    }
    assert.equal(status, 'unchanged');
    assert.equal(calls, 0);
    assert.deepEqual(row[selected], selected === 'tokenUsage' ? tokenUsage() : sessionStats());
  });

  test(`inherited toJSON cannot conceal ${selected} conflict or commit earlier batch rows`, () => {
    const store = createMemoryStore(), input = request(), descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const field = selected === 'tokenUsage' ? 'outputTokens' : 'steps';
    let calls = 0, error, before, after, other;
    try {
      store.ingest(request());
      before = store.get(KEY);
      const unit = input.snapshot.values[selected];
      unit[field] = 99;
      Object.defineProperty(input.snapshot.values, selected, { enumerable: true, get() {
        Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { calls++; return 0; } });
        return unit;
      } });
      try { store.ingestBatch([request(OTHER), input]); } catch (caught) { error = caught; }
    } finally {
      restorePrototype('toJSON', descriptor);
      after = store.get(KEY);
      other = store.get(OTHER);
      store.close();
    }
    assert.equal(error?.code, 'SEQUENCE_CONFLICT');
    assert.equal(calls, 0);
    assert.deepEqual(after, before);
    assert.equal(other, null);
  });
}

test('inherited toJSON cannot mark a same-sequence missing unit as already filled', () => {
  const store = createMemoryStore(), descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  const first = request();
  delete first.snapshot.values.sessionStats;
  const input = request(), unit = input.snapshot.values.sessionStats;
  let calls = 0, status, row;
  try {
    store.ingest(first);
    Object.defineProperty(input.snapshot.values, 'sessionStats', { enumerable: true, get() {
      Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { calls++; return 0; } });
      return unit;
    } });
    status = store.ingest(input);
    row = store.get(KEY);
  } finally {
    restorePrototype('toJSON', descriptor);
    store.close();
  }
  assert.equal(status, 'updated');
  assert.equal(calls, 0);
  assert.deepEqual(row.sessionStats, sessionStats());
});

for (const selected of ['tokenUsage', 'sessionStats']) {
  const fields = Object.keys(selected === 'tokenUsage' ? tokenUsage() : sessionStats());
  for (const field of fields) {
    test(`same-sequence ${selected}.${field} is compared numerically`, () => {
      const store = createMemoryStore();
      try {
        const first = request();
        first.snapshot.values[selected] = Object.assign(Object.create(null), first.snapshot.values[selected]);
        assert.equal(store.ingest(first), 'inserted');
        assert.equal(store.ingest(request()), 'unchanged');
        const different = request();
        different.snapshot.values[selected][field]++;
        assert.throws(() => store.ingest(different), { code: 'SEQUENCE_CONFLICT' });
        assert.deepEqual(store.get(KEY)[selected], selected === 'tokenUsage' ? tokenUsage() : sessionStats());
      } finally { store.close(); }
    });
  }
}

test('counter negative zero is accepted, NaN rejected, and sequence negative zero rejected', () => {
  const store = createMemoryStore();
  try {
    const first = request();
    first.snapshot.values.tokenUsage.outputTokens = -0;
    assert.equal(store.ingest(first), 'inserted');
    const identical = request();
    identical.snapshot.values.tokenUsage.outputTokens = 0;
    assert.equal(store.ingest(identical), 'unchanged');
    const nan = request(OTHER);
    nan.snapshot.values.tokenUsage.outputTokens = NaN;
    assert.throws(() => store.ingest(nan), { code: 'INVALID_SNAPSHOT' });
    const negativeZeroSequence = request(OTHER);
    negativeZeroSequence.snapshot.asOfSeq = -0;
    assert.throws(() => store.ingest(negativeZeroSequence), { code: 'INVALID_SNAPSHOT' });
    assert.equal(store.get(OTHER), null);
  } finally { store.close(); }
});

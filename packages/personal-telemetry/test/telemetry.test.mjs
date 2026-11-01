import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createMemoryStore } from '../index.mjs';
import { migrate } from '../internal.mjs';

const KEY = 'a'.repeat(64), OTHER = 'b'.repeat(64), SOURCE = 'c'.repeat(64), NEW_SOURCE = 'd'.repeat(64);
const tokenUsage = (n = 1) => ({ uncachedInputTokens: 100 * n, outputTokens: 20 * n, cacheReadTokens: 50 * n, cacheWriteTokens: 5 * n });
const sessionStats = (n = 1) => ({ turns: n, steps: 2 * n, llmMs: 11.5 * n, toolMs: 2.25 * n, ttftMs: 3.75 * n, ttftSteps: n, decodeMs: 4.125 * n, decodeTokens: 20.5 * n });
const snap = (asOfSeq = 10, multiplier = 1) => ({ kind: 'sequenced', asOfSeq, values: { tokenUsage: tokenUsage(multiplier), sessionStats: sessionStats(multiplier) } });
const req = (overrides = {}) => ({ sessionKey: KEY, sourceIdentity: SOURCE, snapshot: snap(), ...overrides });
const make = () => createMemoryStore();

function setup() { const store = make(); return store; }

test('accepts only official sequenced wire values, ignores all payload text', () => {
  const store = setup();
  try {
    const input = req();
    input.snapshot.values.tokenUsage.prompt = 'PROMPT_SECRET_4833';
    input.snapshot.values.sessionStats.reply = 'RESPONSE_SECRET_8091';
    input.snapshot.values.toolArgs = 'TOOL_ARGS_SECRET_0104';
    input.snapshot.values.title = 'TITLE_SECRET_3312';
    input.prompt = 'TOP_SECRET_7311';
    assert.equal(store.ingest(input), 'inserted');
    const row = store.get(KEY);
    assert.equal(row.sessionKey, KEY); assert.equal(row.sourceIdentity, SOURCE); assert.equal(row.asOfSeq, 10);
    assert.deepEqual(row.tokenUsage, tokenUsage()); assert.deepEqual(row.sessionStats, sessionStats());
    assert.equal(row.freshness, 'unknown');
    assert.doesNotMatch(JSON.stringify(row), /SECRET|prompt|reply|toolArgs|title/);
  } finally { store.close(); }
});

test('full snapshots update monotonically, duplicate is idempotent, and old data cannot overwrite', () => {
  const store = setup();
  try {
    assert.equal(store.ingest(req()), 'inserted');
    assert.equal(store.ingest(req()), 'unchanged');
    assert.equal(store.ingest(req({ snapshot: snap(9, 2) })), 'stale');
    assert.deepEqual(store.get(KEY).tokenUsage, tokenUsage());
    assert.equal(store.ingest(req({ snapshot: snap(11, 3) })), 'updated');
    assert.deepEqual(store.get(KEY).tokenUsage, tokenUsage(3));
    assert.deepEqual(store.get(KEY).sessionStats, sessionStats(3));
  } finally { store.close(); }
});

test('same sequence can fill an absent unit but conflicting known values are rejected', () => {
  const store = setup();
  try {
    const onlyToken = { kind: 'sequenced', asOfSeq: 10, values: { tokenUsage: tokenUsage() } };
    assert.equal(store.ingest(req({ snapshot: onlyToken })), 'inserted');
    assert.equal(store.ingest(req()), 'updated');
    assert.deepEqual(store.get(KEY).sessionStats, sessionStats());
    assert.equal(store.ingest(req({ snapshot: onlyToken })), 'unchanged');
    assert.deepEqual(store.get(KEY).sessionStats, sessionStats());
    const differing = { kind: 'sequenced', asOfSeq: 10, values: { sessionStats: sessionStats(3) } };
    assert.throws(() => store.ingest(req({ snapshot: differing })), { code: 'SEQUENCE_CONFLICT' });
    assert.deepEqual(store.get(KEY).sessionStats, sessionStats());
  } finally { store.close(); }
});

test('same-sequence contradictory data and changed source fail atomically', () => {
  const store = setup();
  try {
    store.ingest(req()); const original = store.get(KEY);
    assert.throws(() => store.ingest(req({ snapshot: snap(10, 2) })), { code: 'SEQUENCE_CONFLICT' });
    assert.deepEqual(store.get(KEY), original);
    assert.throws(() => store.ingest(req({ sourceIdentity: NEW_SOURCE, snapshot: snap(11, 2) })), { code: 'SOURCE_CONFLICT' });
    assert.deepEqual(store.get(KEY), original);
    assert.equal(store.ingest(req({ sessionKey: OTHER, snapshot: snap(5, 2) })), 'inserted');
    assert.deepEqual(store.get(OTHER).tokenUsage, tokenUsage(2));
  } finally { store.close(); }
});

test('missing official units remain null, absent older values are not silently carried forward', () => {
  const store = setup();
  try {
    const value = { kind: 'sequenced', asOfSeq: -1, values: {} };
    assert.equal(store.ingest(req({ snapshot: value })), 'inserted');
    assert.equal(store.get(KEY).tokenUsage, null); assert.equal(store.get(KEY).sessionStats, null);
    assert.equal(store.ingest(req()), 'updated');
    assert.equal(store.ingest(req({ snapshot: { kind: 'sequenced', asOfSeq: 11, values: { sessionStats: sessionStats() } } })), 'updated');
    assert.equal(store.get(KEY).tokenUsage, null);
    assert.deepEqual(store.get(KEY).sessionStats, sessionStats());
  } finally { store.close(); }
});

test('rejects unsequenced cache, malformed counters, strings and unsafe ids before any write', () => {
  const store = setup();
  try {
    for (const snapshot of [
      null, { kind: 'migration-required', values: { tokenUsage: tokenUsage() } }, { kind: 'sequenced', asOfSeq: -2, values: {} },
      { kind: 'sequenced', asOfSeq: 0.5, values: {} }, { kind: 'sequenced', asOfSeq: Number.MAX_SAFE_INTEGER + 1, values: {} },
      { kind: 'sequenced', asOfSeq: 2, values: { tokenUsage: { ...tokenUsage(), outputTokens: -1 } } },
      { kind: 'sequenced', asOfSeq: 2, values: { tokenUsage: { ...tokenUsage(), outputTokens: 0.5 } } },
      { kind: 'sequenced', asOfSeq: 2, values: { tokenUsage: { ...tokenUsage(), outputTokens: Infinity } } },
      { kind: 'sequenced', asOfSeq: 2, values: { tokenUsage: { ...tokenUsage(), outputTokens: 'secret' } } },
      { kind: 'sequenced', asOfSeq: 2, values: { tokenUsage: { uncachedInputTokens: 2 } } },
      { kind: 'sequenced', asOfSeq: 2, values: { sessionStats: { ...sessionStats(), llmMs: NaN } } },
      { kind: 'sequenced', asOfSeq: 2, values: { sessionStats: { ...sessionStats(), steps: 1.5 } } },
      { kind: 'sequenced', asOfSeq: 2, values: { sessionStats: null } }
    ]) assert.throws(() => store.ingest(req({ snapshot })), { code: 'INVALID_SNAPSHOT' });
    for (const value of ['', 'raw-session-id', '../actual-path', KEY.toUpperCase(), '0'.repeat(63)]) {
      assert.throws(() => store.ingest(req({ sessionKey: value })), { code: 'INVALID_ID' });
      assert.throws(() => store.ingest(req({ sourceIdentity: value })), { code: 'INVALID_ID' });
    }
    assert.equal(store.get(KEY), null);
  } finally { store.close(); }
});

test('batch writes are transactional; any conflict or invalid row rolls back earlier rows', () => {
  const store = setup();
  try {
    store.ingest(req()); const initial = store.get(KEY);
    assert.throws(() => store.ingestBatch([req({ sessionKey: OTHER }), req({ snapshot: snap(10, 2) })]), { code: 'SEQUENCE_CONFLICT' });
    assert.equal(store.get(OTHER), null); assert.deepEqual(store.get(KEY), initial);
    assert.throws(() => store.ingestBatch([req({ sessionKey: OTHER }), req({ snapshot: null })]), { code: 'INVALID_SNAPSHOT' });
    assert.equal(store.get(OTHER), null);
  } finally { store.close(); }
});

test('cancel during a batch rolls back preceding writes', () => {
  const store = setup(), controller = new AbortController();
  try {
    const second = req();
    Object.defineProperty(second, 'snapshot', { get() { controller.abort(); return snap(); } });
    assert.throws(() => store.ingestBatch([req({ sessionKey: OTHER }), second], { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(store.get(OTHER), null);
    assert.equal(store.get(KEY), null);
  } finally { store.close(); }
});

test('cancelled ingestion leaves all previous data untouched', () => {
  const store = setup(), controller = new AbortController();
  try {
    store.ingest(req());
    controller.abort();
    assert.throws(() => store.ingest(req({ sessionKey: OTHER }), { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(store.get(OTHER), null);
    assert.deepEqual(store.get(KEY).tokenUsage, tokenUsage());
  } finally { store.close(); }
});

test('version migrations are atomic, reentrant and reject unknown future schema', () => {
  const empty = new DatabaseSync(':memory:');
  try {
    migrate(empty); migrate(empty);
    assert.equal(empty.prepare('PRAGMA user_version').get().user_version, 1);
  } finally { empty.close(); }
  const failed = new DatabaseSync(':memory:');
  try {
    failed.exec('CREATE TABLE session_snapshots (malformed TEXT)');
    assert.throws(() => migrate(failed), { code: 'UNSUPPORTED_SCHEMA' });
    assert.equal(failed.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(failed.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='session_snapshots'").get().n, 1);
  } finally { failed.close(); }
  const future = new DatabaseSync(':memory:');
  try {
    future.exec('PRAGMA user_version = 42');
    assert.throws(() => migrate(future), { code: 'UNSUPPORTED_SCHEMA' });
    assert.equal(future.prepare('PRAGMA user_version').get().user_version, 42);
  } finally { future.close(); }
});

test('only safe in-memory database may be used and no destructive or export API exists', () => {
  assert.throws(() => createMemoryStore({ filename: '/Users/yulong/.dsh/analytics/personal-telemetry.db' }), { code: 'UNSUPPORTED_STORAGE' });
  const store = setup();
  try {
    for (const forbidden of ['query', 'exec', 'export', 'purge', 'delete', 'database']) assert.equal(store[forbidden], undefined);
    assert.equal(store.get(OTHER), null);
    assert.throws(() => store.get('raw-session-id'), { code: 'INVALID_ID' });
  } finally { store.close(); }
});

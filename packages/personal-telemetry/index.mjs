import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migration.mjs';

const TOKEN = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
const STATS = ['turns', 'steps', 'llmMs', 'toolMs', 'ttftMs', 'ttftSteps', 'decodeMs', 'decodeTokens'];
const COUNTS = new Set([...TOKEN, 'turns', 'steps', 'ttftSteps']);
const FIELDS = [...TOKEN, ...STATS];

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function checkId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) fail('INVALID_ID', 'Identifiers must be 64 lowercase hex digits');
}
function unit(value, fields) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SNAPSHOT', 'Invalid projection unit');
  // Validated counters must never pass through inherited setters: an input
  // getter can install one, altering or leaking this intermediate object.
  const result = Object.create(null);
  for (const name of fields) {
    const n = value[name];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER || (COUNTS.has(name) && !Number.isSafeInteger(n))) {
      fail('INVALID_SNAPSHOT', `Invalid projection counter: ${name}`);
    }
    result[name] = n;
  }
  return result;
}
function equalUnit(left, right, fields) {
  if (left === null || right === null) return left === right;
  for (const name of fields) {
    if (left[name] !== right[name]) return false;
  }
  return true;
}
function normalize({ sessionKey, sourceIdentity, snapshot } = {}) {
  checkId(sessionKey); checkId(sourceIdentity);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    fail('INVALID_SNAPSHOT', 'A sequenced authoritative projection snapshot is required');
  }
  const { kind, asOfSeq, values } = snapshot;
  if (kind !== 'sequenced' || !Number.isSafeInteger(asOfSeq) || asOfSeq < -1 || Object.is(asOfSeq, -0) || !values || typeof values !== 'object' || Array.isArray(values)) {
    fail('INVALID_SNAPSHOT', 'A sequenced authoritative projection snapshot is required');
  }
  const { tokenUsage, sessionStats } = values;
  return {
    sessionKey, sourceIdentity, asOfSeq,
    tokenUsage: unit(tokenUsage, TOKEN),
    sessionStats: unit(sessionStats, STATS),
    freshness: 'unknown'
  };
}
export function createMemoryStore(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Reflect.ownKeys(options).length !== 0) fail('UNSUPPORTED_STORAGE', 'Only a new in-memory store is supported');
  const database = new DatabaseSync(':memory:');
  try { migrate(database); } catch (error) { database.close(); throw error; }
  const getStmt = database.prepare('SELECT * FROM session_snapshots WHERE session_key = ?');
  const putStmt = database.prepare(`INSERT INTO session_snapshots (session_key,source_identity,as_of_seq,${FIELDS.join(',')},freshness)
    VALUES (${Array(3 + FIELDS.length + 1).fill('?').join(',')})
    ON CONFLICT(session_key) DO UPDATE SET source_identity=excluded.source_identity,as_of_seq=excluded.as_of_seq,${FIELDS.map(field => `${field}=excluded.${field}`).join(',')},freshness=excluded.freshness`);
  function get(sessionKey) {
    checkId(sessionKey);
    const row = getStmt.get(sessionKey);
    if (!row) return null;
    const projection = fields => row[fields[0]] === null ? null : Object.fromEntries(fields.map(name => [name, row[name]]));
    return { sessionKey: row.session_key, sourceIdentity: row.source_identity, asOfSeq: row.as_of_seq,
      tokenUsage: projection(TOKEN), sessionStats: projection(STATS), freshness: row.freshness };
  }
  function ingestBatch(requests, { signal } = {}) {
    if (!Array.isArray(requests)) fail('INVALID_SNAPSHOT', 'An array of snapshots is required');
    signal?.throwIfAborted();
    database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const request of requests) {
        signal?.throwIfAborted();
        const next = normalize(request), previous = get(next.sessionKey);
        if (previous && previous.sourceIdentity !== next.sourceIdentity) fail('SOURCE_CONFLICT', 'Source identity changed; rebuild requires explicit handling');
        if (previous && previous.asOfSeq > next.asOfSeq) { results.push('stale'); continue; }
        if (previous && previous.asOfSeq === next.asOfSeq) {
          for (const [key, fields] of [['tokenUsage', TOKEN], ['sessionStats', STATS]]) {
            if (previous[key] !== null && next[key] !== null && !equalUnit(previous[key], next[key], fields)) fail('SEQUENCE_CONFLICT', 'Conflicting snapshots at the same sequence');
            next[key] ??= previous[key];
          }
          if (equalUnit(previous.tokenUsage, next.tokenUsage, TOKEN) && equalUnit(previous.sessionStats, next.sessionStats, STATS)) { results.push('unchanged'); continue; }
        }
        const numbers = [...TOKEN.map(name => next.tokenUsage?.[name] ?? null), ...STATS.map(name => next.sessionStats?.[name] ?? null)];
        putStmt.run(next.sessionKey, next.sourceIdentity, next.asOfSeq, ...numbers, next.freshness);
        results.push(previous ? 'updated' : 'inserted');
      }
      signal?.throwIfAborted();
      database.exec('COMMIT');
      return results;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  return Object.freeze({
    ingest(request, options) { return ingestBatch([request], options)[0]; },
    ingestBatch,
    get,
    close() { database.close(); }
  });
}

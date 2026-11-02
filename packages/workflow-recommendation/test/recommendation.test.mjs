import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../index.mjs';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 0, 31, 12);
const base = overrides => ({
  evidence: 'caller-asserted-complete',
  runs: 10, ok: 8, failed: 2, cancelled: 0, unknown: 0,
  distinctSessions: 2, argsVariants: 2, lastUsedMs: NOW - 2 * DAY,
  nowMs: NOW,
  ...overrides,
});

function expectVerdict(input, verdict) {
  const result = recommend(input);
  assert.equal(result.verdict, verdict, JSON.stringify({ input, result }));
  assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0);
  assert.equal('score' in result, false);
  assert.equal('suggested' in result, false);
  return result;
}

test('threshold decision table keeps overlapping and unspecified cases unknown', () => {
  const cases = [
    [{ runs: 3, ok: 0, failed: 3 }, 'candidate'],
    [{ runs: 3, ok: 3, failed: 0 }, 'candidate'],
    [{ runs: 4, ok: 4, failed: 0 }, 'candidate'],
    [{ runs: 4, ok: 2, failed: 2 }, 'candidate'],
    [{ runs: 10, ok: 6, failed: 4 }, 'not-worth'],
    [{ runs: 10, ok: 7, failed: 3 }, 'candidate'],
    [{ runs: 10, ok: 8, failed: 2 }, 'candidate'],
    [{ runs: 10, ok: 9, failed: 1 }, 'unknown'],
    [{ runs: 10, ok: 10, failed: 0 }, 'unknown'],
    [{ runs: 5, ok: 5, failed: 0, distinctSessions: 1 }, 'not-worth'],
    [{ runs: 5, ok: 5, failed: 0, argsVariants: 4 }, 'not-worth'],
    [{ runs: 5, ok: 5, failed: 0, lastUsedMs: NOW - 30 * DAY }, 'unknown'],
    [{ runs: 5, ok: 5, failed: 0, lastUsedMs: NOW - 30 * DAY - 1 }, 'not-worth'],
    [{ runs: 2, ok: 2, failed: 0 }, 'unknown'],
    [{ runs: 0, ok: 0, failed: 0, distinctSessions: 0, argsVariants: 0, lastUsedMs: null }, 'unknown'],
  ];
  for (const [overrides, verdict] of cases) expectVerdict(base(overrides), verdict);
});

test('invalid, incomplete, cancelled and unresolved input remains unknown', () => {
  for (const overrides of [
    { evidence: undefined }, { evidence: 'verified' }, { evidence: 'partial' },
    { runs: NaN }, { runs: Infinity }, { runs: Number.MAX_SAFE_INTEGER + 1 }, { runs: -1 }, { runs: 1.5 },
    { ok: -1 }, { ok: 8.5 }, { failed: NaN }, { cancelled: 1 }, { unknown: 1 },
    { runs: 10, ok: 7, failed: 1, cancelled: 2 }, { runs: 10, ok: 7, failed: 2 },
    { distinctSessions: -1 }, { distinctSessions: 11 }, { distinctSessions: undefined },
    { argsVariants: 0 }, { argsVariants: 11 }, { argsVariants: NaN },
    { lastUsedMs: undefined }, { lastUsedMs: NaN }, { lastUsedMs: NOW + 1 },
    { nowMs: Infinity }, { nowMs: 1.5 }, { nowMs: Number.MAX_SAFE_INTEGER + 1 },
  ]) expectVerdict(base(overrides), 'unknown');
  for (const value of [null, undefined, 1, [], 'run']) expectVerdict(value, 'unknown');
});

test('omitted data cannot turn a partial sample into a promotion recommendation', () => {
  for (const key of ['runs', 'ok', 'failed', 'cancelled', 'unknown', 'distinctSessions', 'argsVariants', 'lastUsedMs', 'nowMs']) {
    const input = base(); delete input[key];
    expectVerdict(input, 'unknown');
  }
});

test('exact thresholds compare integer counts without rounded success rates', () => {
  expectVerdict(base({ runs: 20, ok: 13, failed: 7 }), 'not-worth');
  expectVerdict(base({ runs: 20, ok: 14, failed: 6 }), 'candidate');
  expectVerdict(base({ runs: 20, ok: 17, failed: 3 }), 'candidate');
  expectVerdict(base({ runs: 20, ok: 18, failed: 2 }), 'unknown');
  expectVerdict(base({ runs: Number.MAX_SAFE_INTEGER, ok: 8106479329266891, failed: 900719925474100 }), 'candidate');
  expectVerdict(base({ runs: Number.MAX_SAFE_INTEGER, ok: 8106479329266892, failed: 900719925474099 }), 'unknown');
  expectVerdict(base({ runs: Number.MAX_SAFE_INTEGER, ok: 6305039478318693, failed: 2702159776422298 }), 'not-worth');
  expectVerdict(base({ runs: Number.MAX_SAFE_INTEGER, ok: 6305039478318694, failed: 2702159776422297 }), 'candidate');
});

test('no result contains source payload or claims verified provenance', () => {
  const privateValue = 'DO_NOT_OUTPUT_PRIVATE_TEXT';
  const result = recommend(base({ payload: privateValue }));
  assert.equal(JSON.stringify(result).includes(privateValue), false);
  assert.equal(JSON.stringify(result).includes('verified'), false);
});

test('inherited metrics and accessor properties cannot provide evidence', () => {
  const inherited = Object.create(base());
  assert.equal(recommend(inherited).verdict, 'unknown');
  const input = base();
  let accessed = false;
  Object.defineProperty(input, 'runs', { get() { accessed = true; return 10; }, enumerable: true });
  assert.equal(recommend(input).verdict, 'unknown');
  assert.equal(accessed, false);
});

test('proxy inputs are rejected without executing traps, including revoked proxies', () => {
  let traps = 0;
  const proxy = new Proxy(base(), { getOwnPropertyDescriptor() { traps++; throw new Error('trap'); } });
  assert.equal(recommend(proxy).verdict, 'unknown');
  assert.equal(traps, 0);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(recommend(revoked.proxy).verdict, 'unknown');
});

const DAY_MS = 24 * 60 * 60 * 1000;
const advice = (verdict, reason) => ({ verdict, reasons: [reason] });
const count = value => Number.isSafeInteger(value) && value >= 0;

// Pure prototype: completeness is a caller assertion, not independently verified.
export function recommend(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return advice('unknown', 'missing-input');
  const { evidence, runs, ok, failed, cancelled, unknown, distinctSessions, argsVariants, lastUsedMs, nowMs } = input;
  if (evidence !== 'caller-asserted-complete') return advice('unknown', 'incomplete-or-untrusted-evidence');
  if (![runs, ok, failed, cancelled, unknown, distinctSessions, argsVariants].every(count) ||
      !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(lastUsedMs)) return advice('unknown', 'missing-or-invalid-metric');
  if (cancelled !== 0 || unknown !== 0) return advice('unknown', 'undefined-outcome-denominator');
  if (BigInt(ok) + BigInt(failed) !== BigInt(runs) || distinctSessions > runs || argsVariants > runs ||
      (runs > 0 && (distinctSessions === 0 || argsVariants === 0)) || lastUsedMs > nowMs) return advice('unknown', 'inconsistent-metrics');
  if (runs < 3) return advice('unknown', 'insufficient-samples');
  if (runs <= 4) return advice('candidate', 'three-or-four-runs');

  const successes = BigInt(ok) * 10n, total = BigInt(runs);
  if (successes < 7n * total) return advice('not-worth', 'success-rate-below-70-percent');
  if (successes < 9n * total) return advice('candidate', 'success-rate-from-70-to-below-90-percent');
  if (successes === 9n * total) return advice('unknown', '90-percent-rules-overlap');
  if (distinctSessions < 2 || argsVariants > 3 || BigInt(nowMs) - BigInt(lastUsedMs) > BigInt(30 * DAY_MS)) {
    return advice('not-worth', 'promotion-prerequisite-not-met');
  }
  return advice('unknown', 'failure-concentration-rule-unspecified');
}

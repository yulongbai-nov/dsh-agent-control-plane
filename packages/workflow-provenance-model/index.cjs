'use strict';
// Offline synthetic relation model only: no caller can establish authority.
const { types: { isProxy } } = require('node:util');
const MAX_RECEIPTS = 128;
const ID = /^fixture-[a-zA-Z0-9][a-zA-Z0-9_-]{0,55}$/;
const TAGS = new Set(['synthetic-source-a', 'synthetic-source-b', 'synthetic-source-c']);
const FIELDS = Object.freeze({
  scope: ['kind', 'workspaceId', 'sessionId'],
  origin: ['kind', 'workspaceId', 'sessionId', 'generationId', 'eventSeq', 'callId', 'sourceTag'],
  attempt: ['kind', 'workspaceId', 'sessionId', 'generationId', 'eventSeq', 'callId', 'attemptId', 'definitionId', 'effectiveSourceTag'],
  accepted: ['kind', 'workspaceId', 'sessionId', 'attemptId', 'runId', 'sourceTag'],
  lifecycle: ['kind', 'workspaceId', 'sessionId', 'runId', 'phase', 'outcome'],
});
function error(code) { return Object.assign(new Error(code), { code }); }
function invalid() { throw error('INVALID_RECEIPT'); }
function capture(input) {
  if (input === null || typeof input !== 'object' || isProxy(input) || Array.isArray(input)) invalid();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) invalid();
  const keys = Reflect.ownKeys(input);
  // Reflect.ownKeys allocates before this bound: do not feed hostile huge objects.
  if (keys.length > 10) invalid();
  const value = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string') invalid();
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
    value[key] = descriptor.value;
  }
  return value;
}
function isId(value) { return typeof value === 'string' && ID.test(value); }
function validateReceipt(input) {
  const data = capture(input);
  const fields = typeof data.kind === 'string' && Object.hasOwn(FIELDS, data.kind) ? FIELDS[data.kind] : undefined;
  if (!fields || Object.keys(data).some((field) => !fields.includes(field))) invalid();
  const required = data.kind === 'lifecycle' && data.phase === 'start' ? fields.filter((field) => field !== 'outcome') : fields;
  if (required.some((field) => !Object.hasOwn(data, field))) invalid();
  if (!isId(data.workspaceId) || !isId(data.sessionId)) invalid();
  for (const key of ['generationId', 'callId', 'attemptId', 'definitionId', 'runId']) {
    if (Object.hasOwn(data, key) && !isId(data[key])) invalid();
  }
  if (Object.hasOwn(data, 'eventSeq') && (!Number.isSafeInteger(data.eventSeq) || data.eventSeq < 0 || Object.is(data.eventSeq, -0))) invalid();
  for (const key of ['sourceTag', 'effectiveSourceTag']) if (Object.hasOwn(data, key) && !TAGS.has(data[key])) invalid();
  if (data.kind === 'lifecycle' && !((data.phase === 'start' && !Object.hasOwn(data, 'outcome')) ||
    (data.phase === 'end' && ['completed', 'error', 'cancelled'].includes(data.outcome)))) invalid();
  const result = {};
  for (const field of fields) if (Object.hasOwn(data, field)) result[field] = data[field];
  return Object.freeze(result);
}
function optionsOf(options) {
  if (options === undefined) return MAX_RECEIPTS;
  let value;
  try { value = capture(options); } catch { throw error('INVALID_OPTIONS'); }
  if (Object.keys(value).some((key) => key !== 'maxReceipts')) throw error('INVALID_OPTIONS');
  const max = Object.hasOwn(value, 'maxReceipts') ? value.maxReceipts : MAX_RECEIPTS;
  if (!Number.isSafeInteger(max) || max < 1 || max > MAX_RECEIPTS) throw error('INVALID_OPTIONS');
  return max;
}
const tuple = (...parts) => JSON.stringify(parts);
const scopeKey = (item) => tuple(item.workspaceId, item.sessionId);
function receiptKey(item) {
  const base = [item.workspaceId, item.sessionId, item.kind];
  switch (item.kind) {
    case 'scope': return tuple(...base);
    case 'origin': return tuple(...base, item.generationId, item.eventSeq);
    case 'attempt': return tuple(...base, item.attemptId);
    case 'accepted': return tuple(...base, item.attemptId);
    case 'lifecycle': return tuple(...base, item.runId, item.phase);
    default: throw error('INVALID_RECEIPT');
  }
}
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function snapshot(groups) {
  const diagnostics = new Set();
  const scopes = new Map();
  function getScope(item) {
    const key = scopeKey(item);
    if (!scopes.has(key)) scopes.set(key, { workspaceId: item.workspaceId, sessionId: item.sessionId, declared: false, records: [] });
    return scopes.get(key);
  }
  for (const group of groups.values()) {
    if (group.variants.size > 1) diagnostics.add('SAME_KEY_CONFLICT');
    for (const value of group.variants.values()) getScope(value).records.push({ value, conflict: group.variants.size > 1 });
  }
  // These receipt shapes have no immutable native event position, so a start
  // and end claim alone cannot establish their chronological order. Preserve
  // them as synthetic observations, never as an ordered log reconstruction.
  const scopeOutput = [];
  const scopedItems = [...scopes.values()].sort((a, b) => order(tuple(a.workspaceId, a.sessionId), tuple(b.workspaceId, b.sessionId)));
  // The model cannot establish whether equal public-looking ids in two scopes
  // are distinct, reused, or forged. Quarantine both rather than joining them.
  const scopedClaims = new Map();
  for (const item of scopedItems) for (const { value } of item.records) {
    const identities = value.kind === 'attempt' ? [['attempt', value.attemptId]] :
      value.kind === 'accepted' ? [['attempt', value.attemptId], ['run', value.runId]] :
      value.kind === 'lifecycle' ? [['run', value.runId]] : [];
    for (const [kind, id] of identities) {
      const key = tuple(kind, id);
      if (!scopedClaims.has(key)) scopedClaims.set(key, new Set());
      scopedClaims.get(key).add(scopeKey(value));
    }
  }
  const crossScope = new Set([...scopedClaims].filter(([, owners]) => owners.size > 1).map(([key]) => key));
  if (crossScope.size) diagnostics.add('CROSS_SCOPE_ID_CONFLICT');
  for (const item of scopedItems) {
    const origins = new Map(), attempts = new Map(), accepted = new Map(), runs = new Map();
    const ensure = (map, key, value) => {
      if (!map.has(key)) map.set(key, value);
      return map.get(key);
    };
    for (const { value, conflict } of item.records) {
      switch (value.kind) {
        case 'scope': item.declared = true; break;
        case 'origin': {
          const key = tuple(value.generationId, value.eventSeq);
          const record = ensure(origins, key, { generationId: value.generationId, eventSeq: value.eventSeq, variants: [], conflict: false, attempts: new Set() });
          record.variants.push(value); record.conflict ||= conflict;
          break;
        }
        case 'attempt': {
          const record = ensure(attempts, value.attemptId, { attemptId: value.attemptId, variants: [], conflict: false });
          record.variants.push(value); record.conflict ||= conflict;
          break;
        }
        case 'accepted': {
          const record = ensure(accepted, value.attemptId, { variants: [], conflict: false });
          record.variants.push(value); record.conflict ||= conflict;
          break;
        }
        case 'lifecycle': {
          const record = ensure(runs, value.runId, { runId: value.runId, start: [], end: [], conflict: false, claims: new Set() });
          record[value.phase].push(value); record.conflict ||= conflict;
          break;
        }
      }
    }
    // Call ids in this synthetic contract are unique within one scope and
    // source generation. Across generations a reused id is not a join.
    const callOrigins = new Map();
    for (const [key, origin] of origins) for (const variant of origin.variants) {
      const claimKey = tuple(variant.generationId, variant.callId);
      if (!callOrigins.has(claimKey)) callOrigins.set(claimKey, new Set());
      callOrigins.get(claimKey).add(key);
    }
    for (const keys of callOrigins.values()) if (keys.size > 1) {
      diagnostics.add('CALL_ORIGIN_CONFLICT');
      for (const key of keys) origins.get(key).conflict = true;
    }
    for (const [attemptId, record] of attempts) {
      for (const variant of record.variants) {
        const origin = origins.get(tuple(variant.generationId, variant.eventSeq));
        if (origin && origin.variants.some((entry) => entry.callId === variant.callId)) origin.attempts.add(attemptId);
      }
    }
    for (const [attemptId, record] of accepted) for (const variant of record.variants) {
      const run = ensure(runs, variant.runId, { runId: variant.runId, start: [], end: [], conflict: false, claims: new Set() });
      run.claims.add(attemptId);
      if (record.conflict) run.conflict = true;
    }
    for (const record of attempts.values()) {
      if (crossScope.has(tuple('attempt', record.attemptId))) record.conflict = true;
    }
    for (const run of runs.values()) {
      if (crossScope.has(tuple('run', run.runId))) run.conflict = true;
      if ([...run.claims].some((id) => crossScope.has(tuple('attempt', id)))) run.conflict = true;
      if (run.claims.size > 1) { run.conflict = true; diagnostics.add('RUN_OWNERSHIP_CONFLICT'); }
      for (const ownerId of run.claims) {
        const owner = attempts.get(ownerId);
        if (!owner) continue;
        if (owner.conflict) run.conflict = true;
        for (const variant of owner.variants) {
          if (origins.get(tuple(variant.generationId, variant.eventSeq))?.conflict) run.conflict = true;
        }
      }
    }
    function factsFor(record) {
      const variant = record?.variants.length === 1 ? record.variants[0] : undefined;
      const origin = variant && origins.get(tuple(variant.generationId, variant.eventSeq));
      const originMatch = !!origin && origin.variants.length === 1 && origin.variants[0].callId === variant.callId;
      const receipt = record && accepted.get(record.attemptId);
      const acceptedValue = receipt?.variants.length === 1 ? receipt.variants[0] : undefined;
      const run = acceptedValue && runs.get(acceptedValue.runId);
      const conflict = !!record?.conflict || !!origin?.conflict || !!receipt?.conflict || !!run?.conflict;
      const consistent = item.declared && !!variant && originMatch && !!acceptedValue;
      return { variant, origin, originMatch, acceptedValue, run, conflict, consistent };
    }
    const attemptOutput = [];
    for (const record of [...attempts.values()].sort((a, b) => order(a.attemptId, b.attemptId))) {
      const { variant, origin, originMatch, acceptedValue, run, conflict, consistent } = factsFor(record);
      const relation = conflict ? 'conflict' : consistent ? 'consistent' : 'incomplete';
      const observedEnd = relation === 'consistent' && run && run.start.length === 1 && run.end.length === 1 ? run.end[0].outcome : null;
      attemptOutput.push({ attemptId: record.attemptId, relation, sources: {
        original: !conflict && originMatch ? origin.variants[0].sourceTag : null,
        effective: !conflict && variant ? variant.effectiveSourceTag : null,
        accepted: !conflict && acceptedValue ? acceptedValue.sourceTag : null,
      }, lifecycle: 'unknown', observedEnd });
    }
    const runOutput = [...runs.values()].sort((a, b) => order(a.runId, b.runId)).map((run) => {
      const owner = run.claims.size === 1 ? attempts.get([...run.claims][0]) : undefined;
      const facts = factsFor(owner);
      const conflict = run.conflict || facts.conflict;
      const relation = conflict ? 'conflict' : facts.consistent && facts.acceptedValue?.runId === run.runId ? 'consistent' : 'incomplete';
      return { runId: run.runId, relation, lifecycle: 'unknown',
        observedEnd: relation === 'consistent' && run.start.length === 1 && run.end.length === 1 ? run.end[0].outcome : null };
    });
    const originOutput = [...origins.values()].sort((a, b) => order(tuple(a.generationId, a.eventSeq), tuple(b.generationId, b.eventSeq)))
      .map((origin) => ({ generationId: origin.generationId, eventSeq: origin.eventSeq,
        relation: origin.conflict ? 'conflict' : item.declared && origin.attempts.size > 0 ? 'consistent' : 'incomplete',
        attempts: origin.attempts.size }));
    const relations = [...originOutput, ...attemptOutput, ...runOutput].map((entry) => entry.relation);
    scopeOutput.push({ workspaceId: item.workspaceId, sessionId: item.sessionId,
      relation: relations.includes('conflict') ? 'conflict' : !item.declared || origins.size === 0 || attempts.size === 0 || relations.includes('incomplete') ? 'incomplete' : 'consistent',
      origins: originOutput, attempts: attemptOutput, runs: runOutput });
  }
  return deepFreeze({ version: 1, mode: 'synthetic-only', sourceCoverage: 'unknown', jobOwnership: 'unknown', scopes: scopeOutput, diagnostics: [...diagnostics].sort(order) });
}
function createModel(options) {
  const limit = optionsOf(options);
  const groups = new Map();
  let count = 0, overflow = false;
  const overflowSnapshot = deepFreeze({ version: 1, mode: 'synthetic-only', state: 'overflow', sourceCoverage: 'unknown', jobOwnership: 'unknown', scopes: [], diagnostics: ['LIMIT'] });
  return Object.freeze({
    observe(input) {
      if (overflow) throw error('LIMIT');
      const value = validateReceipt(input);
      const key = receiptKey(value);
      const serialized = JSON.stringify(value);
      let group = groups.get(key);
      if (group?.variants.has(serialized)) return snapshot(groups);
      if (count >= limit) { overflow = true; throw error('LIMIT'); }
      if (!group) { group = { variants: new Map() }; groups.set(key, group); }
      group.variants.set(serialized, value);
      count++;
      return snapshot(groups);
    },
    read() { return overflow ? overflowSnapshot : snapshot(groups); },
  });
}
function requiredProvenance() { return Object.freeze({ status: 'unsupported' }); }
module.exports = { validateReceipt, createModel, requiredProvenance };

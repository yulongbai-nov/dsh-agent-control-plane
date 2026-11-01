import { types } from 'node:util';

// Trusted same-realm intrinsics must be intact before this module is loaded.
const LIMIT = 1000;
const isProxy = types.isProxy;
const ownKeys = Reflect.ownKeys;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const prototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const apply = Reflect.apply;
const mapSize = ownDescriptor(Map.prototype, 'size').get;
const mapEntries = Map.prototype.entries;
const iteratorNext = prototypeOf(apply(mapEntries, new Map(), [])).next;
const MODES = new Set(['one-shot', 'continuable', 'external', 'unknown']);
const STATES = new Set(['ready', 'idle', 'loading', 'error', 'migration-required']);
const invalid = () => ({ status: 'invalid', edges: [], issues: [{ code: 'INVALID_INPUT' }] });
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const fail = () => { throw new TypeError('invalid'); };

// Inspect descriptors, never invoke input-owned getters/proxies or inherited properties.
function objectData(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || isProxy(value) ||
      (prototypeOf(value) !== Object.prototype && prototypeOf(value) !== null)) fail();
  const keys = ownKeys(value);
  if (keys.length > allowed.length) fail();
  const copy = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail();
    const descriptor = ownDescriptor(value, key);
    if (!descriptor || !hasOwn(descriptor, 'value') || !descriptor.enumerable) fail();
    copy[key] = descriptor.value;
  }
  for (const key of required) if (!hasOwn(copy, key)) fail();
  return copy;
}
function arrayData(value, remaining) {
  if (!value || typeof value !== 'object' || isProxy(value) || !isArray(value) || prototypeOf(value) !== Array.prototype) fail();
  const lengthDescriptor = ownDescriptor(value, 'length');
  if (!lengthDescriptor || !hasOwn(lengthDescriptor, 'value')) fail();
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > remaining) fail();
  const keys = ownKeys(value);
  // Reject holes, inherited indices, accessors, non-index properties and symbols.
  if (keys.length !== length + 1) fail();
  const copy = [];
  for (let index = 0; index < length; index++) {
    const descriptor = ownDescriptor(value, String(index));
    if (!descriptor || !hasOwn(descriptor, 'value') || !descriptor.enumerable) fail();
    copy.push(descriptor.value);
  }
  return copy;
}
function catalogData(value) {
  if (!value || typeof value !== 'object' || isProxy(value) || prototypeOf(value) !== Map.prototype || ownKeys(value).length !== 0) fail();
  const size = apply(mapSize, value, []);
  if (!Number.isSafeInteger(size) || size < 0 || size > LIMIT) fail();
  const iterator = apply(mapEntries, value, []), copy = [];
  // Check actual iteration count, not just the initial size.
  for (let count = 0; count <= LIMIT; count++) {
    const next = apply(iteratorNext, iterator, []);
    if (next.done) { if (count !== size) fail(); return copy; }
    if (count === LIMIT) fail();
    copy.push(next.value);
  }
  fail();
}

// Caller must pre-authorize and review source edges; this function cannot authenticate them.
export function inspectCandidates(input) {
  try {
    const top = objectData(input, ['roots', 'catalogs']);
    const roots = arrayData(top.roots, LIMIT);
    const catalogEntries = catalogData(top.catalogs);
    const rootSet = new Set(), selectedRoots = [];
    for (const root of roots) {
      if (!id(root) || rootSet.has(root)) fail();
      rootSet.add(root); selectedRoots.push(root);
    }
    const records = new Map();
    let total = roots.length;
    for (const [parentId, rawRecord] of catalogEntries) {
      if (!id(parentId)) fail();
      const record = objectData(rawRecord, ['provenance', 'state', 'entries'], ['state']);
      const { provenance, state } = record;
      if (!STATES.has(state)) fail();
      if (provenance === 'caller-reviewed' && state === 'ready' && !hasOwn(record, 'entries')) fail();
      const entries = hasOwn(record, 'entries') ? arrayData(record.entries, LIMIT - total) : [];
      total += entries.length;
      const copied = [];
      for (const rawEntry of entries) {
        const entry = objectData(rawEntry, ['id', 'mode']);
        if (!id(entry.id) || !MODES.has(entry.mode)) fail();
        copied.push({ parentId, childId: entry.id, mode: entry.mode });
      }
      if (provenance !== 'caller-reviewed') records.set(parentId, { issue: 'UNREVIEWED_CATALOG' });
      else if (state !== 'ready') records.set(parentId, { issue: 'CATALOG_UNAVAILABLE' });
      else records.set(parentId, { entries: copied });
    }
    // Conflict analysis is conservative over potentially reachable known-mode edges.
    const reachable = new Set(), pending = [...selectedRoots];
    for (let i = 0; i < pending.length; i++) {
      const parentId = pending[i];
      if (reachable.has(parentId)) continue;
      reachable.add(parentId);
      for (const edge of records.get(parentId)?.entries ?? []) {
        if (edge.mode === 'continuable' || edge.mode === 'one-shot') pending.push(edge.childId);
      }
    }
    const incoming = new Map();
    for (const parentId of reachable) for (const edge of records.get(parentId)?.entries ?? []) {
      const list = incoming.get(edge.childId) ?? [];
      list.push(edge); incoming.set(edge.childId, list);
    }
    const ambiguous = new Set();
    const incomingIterator = apply(mapEntries, incoming, []);
    for (let count = 0; count <= LIMIT; count++) {
      const next = apply(iteratorNext, incomingIterator, []);
      if (next.done) break;
      if (count === LIMIT) fail();
      const [childId, childEdges] = next.value;
      if (rootSet.has(childId) || childEdges.length > 1) ambiguous.add(childId);
    }
    const edges = [], issues = [], visited = new Set(), queue = [...selectedRoots];
    for (let index = 0; index < queue.length; index++) {
      const parentId = queue[index];
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      const record = records.get(parentId);
      if (!record) { issues.push({ code: 'MISSING_CATALOG', parentId }); continue; }
      if (record.issue) { issues.push({ code: record.issue, parentId }); continue; }
      for (const edge of record.entries) {
        const status = edge.mode === 'unknown' ? 'unknown' : ambiguous.has(edge.childId) ? 'ambiguous' : edge.mode === 'external' ? 'external' : 'candidate';
        edges.push({ ...edge, status });
        if (ambiguous.has(edge.childId)) issues.push({ code: 'AMBIGUOUS_IDENTITY', parentId });
        if (edge.mode === 'unknown') issues.push({ code: 'UNKNOWN_MODE', parentId });
        if (status === 'candidate') queue.push(edge.childId);
      }
    }
    if (issues.length) for (const edge of edges) if (edge.status === 'candidate') edge.status = 'pending';
    return { status: issues.length ? 'incomplete' : 'complete', edges, issues };
  } catch { return invalid(); }
}

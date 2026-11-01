import { types } from 'node:util';

const LIMIT = 1000;
const MODES = new Set(['one-shot', 'continuable', 'external', 'unknown']);
const STATES = new Set(['ready', 'idle', 'loading', 'error', 'migration-required']);
const invalid = () => ({ status: 'invalid', edges: [], issues: [{ code: 'INVALID_INPUT' }] });
const plain = value => value !== null && typeof value === 'object' && !types.isProxy(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

// Caller must pre-authorize and review source edges; this function cannot authenticate them.
export function inspectCandidates(input) {
  try {
    if (!plain(input)) return invalid();
    const { roots, catalogs } = input;
    if (types.isProxy(roots) || !Array.isArray(roots) || roots.length > LIMIT ||
        types.isProxy(catalogs) || !(catalogs instanceof Map) || catalogs.size > LIMIT) return invalid();
    // Arrays and Maps are caller-supplied data, never executable iteration hooks.
    if (Object.getPrototypeOf(roots) !== Array.prototype || Object.getPrototypeOf(catalogs) !== Map.prototype ||
        Reflect.ownKeys(catalogs).length !== 0) return invalid();
    const rootSet = new Set(), selectedRoots = [];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (!id(root) || rootSet.has(root)) return invalid();
      rootSet.add(root); selectedRoots.push(root);
    }
    const records = new Map();
    let total = roots.length;
    for (const [parentId, record] of catalogs) {
      if (!id(parentId) || !plain(record)) return invalid();
      const { provenance, state } = record;
      if (provenance !== 'caller-reviewed') { records.set(parentId, { issue: 'UNREVIEWED_CATALOG' }); continue; }
      if (!STATES.has(state)) return invalid();
      if (state !== 'ready') { records.set(parentId, { issue: 'CATALOG_UNAVAILABLE' }); continue; }
      const entries = record.entries;
      if (types.isProxy(entries) || !Array.isArray(entries) || Object.getPrototypeOf(entries) !== Array.prototype || (total += entries.length) > LIMIT) return invalid();
      const copied = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!plain(entry)) return invalid();
        const { id: childId, mode } = entry;
        if (!id(childId) || !MODES.has(mode)) return invalid();
        copied.push({ parentId, childId, mode });
      }
      records.set(parentId, { entries: copied });
    }
    // Only catalogs reachable from caller-selected roots can influence their candidates.
    const reachable = new Set(), pending = [...selectedRoots];
    for (let i = 0; i < pending.length; i++) {
      const parentId = pending[i];
      if (reachable.has(parentId)) continue;
      reachable.add(parentId);
      for (const edge of records.get(parentId)?.entries ?? []) if (edge.mode !== 'external') pending.push(edge.childId);
    }
    const incoming = new Map();
    for (const parentId of reachable) for (const edge of records.get(parentId)?.entries ?? []) {
      const list = incoming.get(edge.childId) ?? [];
      list.push(edge); incoming.set(edge.childId, list);
    }
    const ambiguous = new Set([...incoming].filter(([childId, edges]) => rootSet.has(childId) || edges.length > 1).map(([childId]) => childId));
    const edges = [], issues = [], visited = new Set(), queue = [...selectedRoots];
    while (queue.length) {
      const parentId = queue.shift();
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      const record = records.get(parentId);
      if (!record) { issues.push({ code: 'MISSING_CATALOG', parentId }); continue; }
      if (record.issue) { issues.push({ code: record.issue, parentId }); continue; }
      for (const edge of record.entries) {
        const status = ambiguous.has(edge.childId) ? 'ambiguous' : edge.mode === 'external' ? 'external' : 'candidate';
        edges.push({ ...edge, status });
        if (status === 'ambiguous') issues.push({ code: 'AMBIGUOUS_IDENTITY', parentId });
        if (status === 'candidate') queue.push(edge.childId);
      }
    }
    return { status: issues.length ? 'incomplete' : 'complete', edges, issues };
  } catch { return invalid(); }
}

// Experimental, browser-safe projection logic for the independent tree prototype.
// This is not the native workspace filter or an authorization decision.
function validId(value) { return typeof value === 'string' && value.length > 0; }
function ownValue(object, key) { return object != null && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined; }

function catalogOf(snapshot) {
  const entries = Array.isArray(snapshot?.values?.subagentCatalog) ? snapshot.values.subagentCatalog : undefined;
  const state = snapshot?.state;
  if (!snapshot) return { state: 'unloaded', entries: [] };
  if (state === 'migration-required') return { state: 'migration-required', entries: entries ?? [] };
  if (state === 'error') return { state: 'error', entries: entries ?? [], error: snapshot.error?.message };
  if (state === 'loading') return { state: 'loading', entries: entries ?? [] };
  if (state === 'idle') {
    // An idle empty catalog may be a stale cache hint, not a known leaf.
    return entries?.length ? { state: 'ready', entries } : { state: 'unloaded', entries: entries ?? [] };
  }
  if (state === 'ready') return entries !== undefined ? { state: 'ready', entries } : { state: 'unavailable', entries: [] };
  // Keep cached entries as conservative conflict evidence, not navigable rows.
  return { state: 'unknown', entries: entries ?? [] };
}
function rowStatus(summary, uiStatus, archived) {
  if (archived) return 'archived';
  if (uiStatus?.pendingInteraction) return 'waiting';
  const running = uiStatus?.running ?? summary?.running;
  if (running === true) return 'running';
  if (running === undefined) return 'unknown';
  if (summary?.projectionValues?.subagentTiming?.lastTurnCompleted === true) return 'completed';
  return 'inactive';
}
// Inspect only already-cached catalogs reachable from visible roots; do not fetch.
function buildRows(list, expanded, archived, statuses) {
  const rows = [], byId = list.byId ?? {}, projections = list.projectionsBySession ?? {};
  const listed = new Set(list.ids ?? []);
  const roots = (list.ids ?? []).filter(id => {
    const row = ownValue(byId, id);
    return validId(id) && row && row.origin !== 'subagent' && !(row.blank && !(row.retainedBy?.mainView > 0));
  });
  const incoming = new Map(), pending = [...new Set(roots)], scanned = new Set();
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i];
    if (scanned.has(id)) continue;
    scanned.add(id);
    const catalog = catalogOf(ownValue(projections, id));
    if (catalog.state === 'migration-required' || ownValue(byId, id)?.formatStatus === 'migration-required') continue;
    for (const entry of catalog.entries) {
      if (!validId(entry?.id)) continue;
      incoming.set(entry.id, (incoming.get(entry.id) ?? 0) + 1);
      if (entry.mode === 'one-shot' || entry.mode === 'continuable') pending.push(entry.id);
    }
  }
  const rootCounts = new Map();
  for (const id of roots) rootCounts.set(id, (rootCounts.get(id) ?? 0) + 1);
  function visit(id, parentId, entry, level, ancestors, rowKey, parentKey) {
    if (!validId(id)) return;
    const summary = ownValue(byId, id);
    const catalog = catalogOf(ownValue(projections, id));
    const mode = entry?.mode;
    const external = mode === 'external';
    const unknownMode = parentId !== null && !external && mode !== 'one-shot' && mode !== 'continuable';
    const ambiguous = ancestors.has(id) || (parentId === null ? rootCounts.get(id) > 1 || (incoming.get(id) ?? 0) > 0 : (incoming.get(id) ?? 0) > 1 || rootCounts.has(id));
    const migrationRequired = summary?.formatStatus === 'migration-required' || catalog.state === 'migration-required';
    const knownLeaf = catalog.state === 'ready' && catalog.entries.length === 0;
    const isArchived = archived.has(id);
    const title = (typeof summary?.title === 'string' && summary.title.trim()) || (typeof entry?.label === 'string' && entry.label.trim()) || (typeof summary?.displayTitle === 'string' && summary.displayTitle) || id;
    const sessionState = statuses.get(id);
    // Catalog fallback rows use running=false without establishing live status.
    const knownSummary = listed.has(id) ? summary : { ...summary, running: undefined };
    const canExpand = !ambiguous && !unknownMode && !external && !migrationRequired && !knownLeaf;
    const depthLimit = canExpand && level >= 128;
    const expandable = canExpand && !depthLimit;
    const row = {
      id, parentId, rowKey, parentKey, mode, level, title, external, unknownMode, ambiguous, archived: isArchived, migrationRequired,
      status: rowStatus(knownSummary, sessionState, isArchived),
      role: summary?.role, agentPreset: summary?.agentPreset ?? summary?.projectionValues?.agentPreset,
      model: summary?.agentModel,
      current: (summary?.retainedBy?.mainView ?? 0) > 0,
      catalogState: catalog.state, error: catalog.error, depthLimit,
      expandable, expanded: expanded.has(id) && expandable
    };
    rows.push(row);
    if (!row.expanded || catalog.state === 'unknown') return;
    const next = new Set(ancestors); next.add(id);
    const occurrences = new Map();
    for (const nextEntry of catalog.entries) {
      if (!validId(nextEntry?.id)) continue;
      const ordinal = occurrences.get(nextEntry.id) ?? 0;
      occurrences.set(nextEntry.id, ordinal + 1);
      const childKey = `${rowKey}/${nextEntry.id.length}:${nextEntry.id}:${ordinal}`;
      visit(nextEntry.id, id, nextEntry, level + 1, next, childKey, rowKey);
    }
  }
  const rootOccurrences = new Map();
  for (const id of roots) {
    const ordinal = rootOccurrences.get(id) ?? 0;
    rootOccurrences.set(id, ordinal + 1);
    visit(id, null, undefined, 1, new Set(), `${id.length}:${id}:${ordinal}`, null);
  }
  const siblings = new Map();
  for (const row of rows) {
    const group = siblings.get(row.parentKey) ?? [];
    group.push(row);
    siblings.set(row.parentKey, group);
  }
  for (const group of siblings.values()) group.forEach((row, index) => { row.posInSet = index + 1; row.setSize = group.length; });
  return rows;
}
function navigationTarget(row) {
  if (row.archived || row.external || row.ambiguous || row.unknownMode || !validId(row.id)) return null;
  if (row.parentId === null) return row.id;
  if (!validId(row.parentId) || !['continuable', 'one-shot'].includes(row.mode)) return null;
  return { parentSessionId: row.parentId, childSessionId: row.id, mode: row.mode };
}

export { catalogOf, buildRows, navigationTarget };

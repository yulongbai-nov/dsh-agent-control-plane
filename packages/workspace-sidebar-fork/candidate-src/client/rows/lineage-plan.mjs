// Experimental source integration: the original native list remains authoritative
// for which roots are visible, their order, search, sorting and watermarks.
// This uses the shared experimental lineage logic; it is not an authorization gate.
import { buildRows, navigationTarget } from '../../../../session-tree/lineage.mjs';

export function canInspectScope({ rootId, scopeRootIds, list }) {
  try {
    // The already supplied session list is the only conflict inventory; never
    // fetch another root here. A partial, sparse, or duplicate inventory fails closed.
    if (!list || list.phase !== 'ready' || !Array.isArray(list.ids) || !Array.isArray(scopeRootIds)) return false;
    if (!list.byId || typeof list.byId !== 'object' || Array.isArray(list.byId)) return false;
    const denseIds = ids => {
      for (let i = 0; i < ids.length; i++) if (!Object.hasOwn(ids, i) || typeof ids[i] !== 'string' || ids[i].length === 0) return false;
      return new Set(ids).size === ids.length;
    };
    if (!denseIds(list.ids) || !denseIds(scopeRootIds)) return false;
    if (list.ids.some(id => !Object.hasOwn(list.byId, id) || !list.byId[id] || list.byId[id].id !== id)) return false;
    const listed = new Set(list.ids);
    return scopeRootIds.includes(rootId) && scopeRootIds.every(id => listed.has(id));
  } catch { return false; }
}

// Only use the already supplied workspace snapshot. The result is a defensive
// UI signal, not evidence that any session or catalog is authorized.
export function duplicateWorkspaceRoots(workspaces) {
  try {
    if (!Array.isArray(workspaces)) return null;
    const seen = new Set(), duplicate = new Set();
    for (const workspace of workspaces) {
      if (!workspace || !Array.isArray(workspace.sessionIds)) return null;
      for (const id of workspace.sessionIds) {
        if (typeof id !== 'string' || id.length === 0) return null;
        if (seen.has(id)) duplicate.add(id); else seen.add(id);
      }
    }
    return duplicate;
  } catch { return null; }
}

export function planLineage({ rootId, scopeRootIds, list, expanded, archived, statuses, archivedFilter }) {
  if (!canInspectScope({ rootId, scopeRootIds, list }) ||
      !['default', 'show', 'only'].includes(archivedFilter) ||
      !(expanded instanceof Set) || !(archived instanceof Set) || !(statuses instanceof Map)) return [];
  const rows = buildRows(list, expanded, archived, statuses);
  const root = rows.find(row => row.parentId === null && row.id === rootId);
  if (!root) return [];
  const children = [], hidden = new Set();
  let inside = false;
  for (const row of rows) {
    if (row.parentId === null) { inside = row.rowKey === root.rowKey; continue; }
    if (!inside) continue;
    if (hidden.has(row.parentKey) || (archivedFilter === 'default' && row.archived) || (archivedFilter === 'only' && !row.archived)) {
      hidden.add(row.rowKey); continue;
    }
    children.push({ ...row, target: navigationTarget(row) });
  }
  return children;
}

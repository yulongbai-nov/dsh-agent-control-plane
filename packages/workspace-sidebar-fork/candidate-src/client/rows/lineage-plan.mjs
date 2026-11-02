// Experimental source integration: the original native list remains authoritative
// for which roots are visible, their order, search, sorting and watermarks.
// This uses the shared experimental lineage logic; it is not an authorization gate.
import { buildRows, navigationTarget } from '../../../../session-tree/lineage.mjs';

export function planLineage({ rootId, scopeRootIds, list, expanded, archived, statuses, archivedFilter }) {
  if (!scopeRootIds.includes(rootId)) return [];
  const rows = buildRows({ ...list, ids: scopeRootIds }, expanded, archived, statuses);
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

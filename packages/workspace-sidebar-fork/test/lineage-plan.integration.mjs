import test from 'node:test';
import assert from 'node:assert/strict';
import { planLineage } from '../candidate-src/client/rows/lineage-plan.mjs';

const ready = entries => ({ state: 'ready', values: { subagentCatalog: entries } });
const child = id => ({ id, mode: 'continuable', label: id });
const summary = id => ({ id, title: id, running: false, retainedBy: {} });
function fixture() {
  const ids = ['root', 'other'];
  const list = { ids, byId: Object.fromEntries(ids.map(id => [id, summary(id)])), projectionsBySession: {
    root: ready([child('child')]), child: ready([child('grandchild')]), grandchild: ready([]), other: ready([])
  } };
  return { rootId:'root', scopeRootIds: ids, list, expanded:new Set(['root','child']), archived:new Set(), statuses:new Map(), archivedFilter:'default' };
}
test('supplements only the selected native root, with direct parent navigation', () => {
  const input=fixture(), before=structuredClone(input.list), rows=planLineage(input);
  assert.deepEqual(rows.map(row=>row.id),['child','grandchild']);
  assert.deepEqual(rows.map(row=>row.target),[{parentSessionId:'root',childSessionId:'child',mode:'continuable'},{parentSessionId:'child',childSessionId:'grandchild',mode:'continuable'}]);
  assert.deepEqual(input.list,before);assert.deepEqual(input.scopeRootIds,['root','other']);
});
test('cached cross-root conflict is non-navigable and stops descent', () => {
  const input=fixture();input.list.projectionsBySession.other=ready([child('child')]);
  const rows=planLineage(input);assert.equal(rows.length,1);assert.equal(rows[0].ambiguous,true);assert.equal(rows[0].target,null);
});
test('closed roots and archived branches produce no visible children', () => {
  const input=fixture();input.expanded.delete('root');assert.deepEqual(planLineage(input),[]);
  input.expanded.add('root');input.archived.add('child');assert.deepEqual(planLineage(input),[]);
});
test('unlisted root does not create any rows', () => {
  const input=fixture();input.rootId='foreign';assert.deepEqual(planLineage(input),[]);
});

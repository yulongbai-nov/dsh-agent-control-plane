import test from 'node:test';
import assert from 'node:assert/strict';
import { canInspectScope, duplicateWorkspaceRoots, planLineage } from '../candidate-src/client/rows/lineage-plan.mjs';

const ready = entries => ({ state: 'ready', values: { subagentCatalog: entries } });
const child = id => ({ id, mode: 'continuable', label: id });
const summary = id => ({ id, title: id, running: false, retainedBy: {} });
function fixture() {
  const ids = ['root', 'other'];
  const list = { phase:'ready', ids, byId: Object.fromEntries(ids.map(id => [id, summary(id)])), projectionsBySession: {
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

test('cached collision in a different visible root cannot become navigable merely because groups differ', () => {
  const input=fixture();input.scopeRootIds=['root'];input.list.projectionsBySession.other=ready([child('child')]);
  const rows=planLineage(input);assert.equal(rows.length,1);assert.equal(rows[0].ambiguous,true);assert.equal(rows[0].target,null);
});
test('other root content is never rendered by the selected root planner', () => {
  const input=fixture();input.scopeRootIds=['root'];input.list.projectionsBySession.other=ready([{id:'foreign-secret',mode:'continuable',label:'PRIVATE FOREIGN LABEL'}]);
  const rows=planLineage(input);assert.deepEqual(rows.map(x=>x.id),['child','grandchild']);assert.equal(JSON.stringify(rows).includes('PRIVATE FOREIGN LABEL'),false);assert.equal(JSON.stringify(rows).includes('foreign-secret'),false);
});
test('missing, incomplete, or duplicated listed-root inventory fails closed', () => {
  for(const ids of [undefined,[],['other'],['root','root']]){
    const input=fixture();input.scopeRootIds=['root'];input.list.ids=ids;assert.deepEqual(planLineage(input),[]);
  }
});
test('sparse list and sparse scope arrays fail closed instead of skipping missing entries', () => {
  const input=fixture();input.scopeRootIds=['root'];input.list.ids=['root',,'other'];assert.equal(canInspectScope(input),false);assert.deepEqual(planLineage(input),[]);
  input.list.ids=['root','other'];input.scopeRootIds=['root',,];assert.equal(canInspectScope(input),false);assert.deepEqual(planLineage(input),[]);
});
test('scope roots not backed by the supplied list and malformed filter fail closed', () => {
  const input=fixture();input.scopeRootIds=['root','not-listed'];assert.deepEqual(planLineage(input),[]);
  input.scopeRootIds=['root'];input.archivedFilter='invalid';assert.deepEqual(planLineage(input),[]);
});
test('a listed root without its own matching summary cannot silently escape conflict scanning', () => {
  for(const value of [undefined, {id:'wrong'}, null]){
    const input=fixture();input.scopeRootIds=['root'];input.list.projectionsBySession.other=ready([child('child')]);
    if(value===undefined)delete input.list.byId.other;else input.list.byId.other=value;
    assert.equal(canInspectScope(input),false);assert.deepEqual(planLineage(input),[]);
  }
});
test('collapsed or uncached other roots are not fetched by conflict analysis', () => {
  const input=fixture();input.scopeRootIds=['root'];delete input.list.projectionsBySession.other;
  const before=structuredClone(input.list);assert.deepEqual(planLineage(input).map(row=>row.id),['child','grandchild']);assert.deepEqual(input.list,before);
});
test('duplicate roots across groups or within one group are detected without altering native membership', () => {
  const groups=[{sessionIds:['root','same']},{sessionIds:['other','same']},{sessionIds:['twice','twice']}],before=structuredClone(groups);
  assert.deepEqual([...duplicateWorkspaceRoots(groups)].sort(),['same','twice']);assert.deepEqual(groups,before);
  assert.equal(duplicateWorkspaceRoots([{sessionIds:null}]),null);assert.equal(duplicateWorkspaceRoots(null),null);
});
test('unlisted native root is not eligible for expansion or projection refresh', () => {
  const input=fixture();input.scopeRootIds=['root','not-listed'];assert.equal(canInspectScope(input),false);
  input.scopeRootIds=['root'];assert.equal(canInspectScope(input),true);
  input.list.phase='loading';assert.equal(canInspectScope(input),false);
});

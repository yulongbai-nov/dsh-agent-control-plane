import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCandidates } from '../index.mjs';

const base = () => ({
  roots: ['A', 'B'],
  catalogs: new Map([
    ['A', { provenance: 'caller-reviewed', state: 'ready', entries: [{ id: 'C', mode: 'continuable' }, { id: 'E', mode: 'external' }] }],
    ['C', { provenance: 'caller-reviewed', state: 'ready', entries: [{ id: 'D', mode: 'one-shot' }] }],
    ['D', { provenance: 'caller-reviewed', state: 'ready', entries: [] }],
  ]),
});
const item = (result, parentId, childId) => result.edges.find(edge => edge.parentId === parentId && edge.childId === childId);

test('only caller-reviewed direct edges become candidates; external stays non-navigable', () => {
  const result = inspectCandidates(base());
  assert.equal(result.status, 'incomplete'); // B has no projection
  assert.equal(item(result, 'A', 'C').status, 'candidate');
  assert.equal(item(result, 'C', 'D').status, 'candidate');
  assert.equal(item(result, 'A', 'E').status, 'external');
  assert.ok(result.issues.some(issue => issue.code === 'MISSING_CATALOG' && issue.parentId === 'B'));
  assert.equal('authorized' in item(result, 'A', 'C'), false);
  assert.equal('target' in item(result, 'A', 'C'), false);
});

test('missing, unreviewed and forged source are separately withheld, never candidates', () => {
  for (const [record, code] of [
    [undefined, 'MISSING_CATALOG'],
    [{ state: 'ready', entries: [{ id: 'C', mode: 'continuable' }] }, 'UNREVIEWED_CATALOG'],
    [{ provenance: 'verified', state: 'ready', entries: [{ id: 'C', mode: 'continuable' }] }, 'UNREVIEWED_CATALOG'],
    [{ provenance: true, state: 'ready', entries: [{ id: 'C', mode: 'continuable' }] }, 'UNREVIEWED_CATALOG'],
    [{ provenance: 'caller-reviewed', state: 'idle', entries: [] }, 'CATALOG_UNAVAILABLE'],
    [{ provenance: 'caller-reviewed', state: 'migration-required', entries: [] }, 'CATALOG_UNAVAILABLE'],
  ]) {
    const input = base(); if (record === undefined) input.catalogs.delete('A'); else input.catalogs.set('A', record);
    const result = inspectCandidates(input);
    assert.ok(result.issues.some(issue => issue.code === code && issue.parentId === 'A'));
    assert.equal(item(result, 'A', 'C'), undefined);
    assert.equal(item(result, 'C', 'D'), undefined);
  }
});

test('duplicate same-parent identities and multiple parents cannot choose a winning path', () => {
  const input = base();
  input.catalogs.get('A').entries.push({ id: 'C', mode: 'one-shot' });
  input.catalogs.set('B', { provenance: 'caller-reviewed', state: 'ready', entries: [{ id: 'C', mode: 'continuable' }] });
  const result = inspectCandidates(input);
  assert.equal(item(result, 'A', 'C').status, 'ambiguous');
  assert.equal(item(result, 'B', 'C').status, 'ambiguous');
  assert.equal(item(result, 'C', 'D'), undefined);
  assert.ok(result.issues.some(issue => issue.code === 'AMBIGUOUS_IDENTITY'));
});

test('roots and cycles cannot be presented as navigable child identities', () => {
  const input = base(); input.catalogs.get('C').entries.push({ id: 'A', mode: 'continuable' });
  const result = inspectCandidates(input);
  assert.equal(item(result, 'C', 'A').status, 'ambiguous');
  assert.ok(result.issues.some(issue => issue.code === 'AMBIGUOUS_IDENTITY'));
  const twice = base(); twice.roots.push('A');
  assert.equal(inspectCandidates(twice).status, 'invalid');
  const cyc = base();
  cyc.catalogs.get('C').entries.push({ id: 'C', mode: 'continuable' });
  const self = inspectCandidates(cyc);
  assert.equal(item(self, 'A', 'C').status, 'ambiguous');
  assert.equal(item(self, 'C', 'C'), undefined);
});

test('unreachable workspace data cannot inject edges or affect selected root candidates', () => {
  const input = base();
  input.catalogs.set('unrelated', { provenance: 'caller-reviewed', state: 'ready', entries: [{ id: 'C', mode: 'continuable' }] });
  const result = inspectCandidates(input);
  assert.equal(item(result, 'A', 'C').status, 'candidate');
  assert.equal(item(result, 'unrelated', 'C'), undefined);
});

test('external and unknown catalog states are not traversed as trusted children', () => {
  const input = base();
  input.catalogs.set('E', { provenance: 'caller-reviewed', state: 'ready', entries: [{ id: 'F', mode: 'one-shot' }] });
  assert.equal(item(inspectCandidates(input), 'E', 'F'), undefined);
  for (const state of ['loading', 'error', 'migration-required', 'idle']) {
    const data = base(); data.catalogs.get('A').state = state;
    assert.equal(item(inspectCandidates(data), 'A', 'C'), undefined);
  }
});

test('malformed inputs, hostile proxies, throwing getters and limits fail closed', () => {
  const malformed = [
    null, {}, { roots: [], catalogs: {} },
    { roots: ['A', 'A'], catalogs: new Map() },
    { roots: [4], catalogs: new Map() },
    { roots: ['A'], catalogs: new Map([['A', { provenance: 'caller-reviewed', state: 'ready', entries: [{ id: 'C', mode: 'bad' }] }]]) },
    { roots: Array.from({ length: 1001 }, (_, i) => `${i}`), catalogs: new Map() },
  ];
  for (const input of malformed) {
    const result = inspectCandidates(input);
    assert.equal(result.status, 'invalid'); assert.deepEqual(result.edges, []);
  }
  const bad = base(); Object.defineProperty(bad.catalogs.get('A'), 'entries', { get() { throw Error('private'); } });
  const result = inspectCandidates(bad);
  assert.equal(result.status, 'invalid'); assert.deepEqual(result.edges, []);
  assert.equal(JSON.stringify(result).includes('private'), false);
  const stable = base(); let reads = 0;
  Object.defineProperty(stable.catalogs.get('A'), 'entries', { get() { reads++; return [{ id: 'C', mode: 'continuable' }]; } });
  assert.equal(item(inspectCandidates(stable), 'A', 'C').status, 'candidate');
  assert.equal(reads, 1);
  const changing = base(); let rootReads = 0;
  Object.defineProperty(changing.roots, 0, { get() { rootReads++; return rootReads === 1 ? 'A' : 'private'; } });
  const snap = inspectCandidates(changing);
  assert.equal(rootReads, 1); assert.equal(JSON.stringify(snap).includes('private'), false);
  let traps = 0; const proxy = new Proxy({}, { get() { traps++; throw Error('private'); } });
  assert.equal(inspectCandidates(proxy).status, 'invalid'); assert.equal(traps, 0);
});

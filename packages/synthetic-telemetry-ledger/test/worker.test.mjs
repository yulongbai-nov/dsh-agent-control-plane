import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openSyntheticLedger } from '../index.mjs';
import { openSyntheticLedgerWorker } from '../worker.mjs';

const sessionKey='a'.repeat(64),sourceEpoch='b'.repeat(64);
const row=(seq=1,n=4)=>({sessionKey,sourceEpoch,asOfSeq:seq,outputTokens:n});
const id=()=>({sessionKey,sourceEpoch});
const code=expected=>e=>e.code===expected;
const dir=()=>{const p=mkdtempSync(join(resolve(tmpdir()),'synthetic-worker-'));chmodSync(p,0o700);return p;};

test('worker persists, reads and drains accepted work before close', async()=>{
 const directory=dir(), worker=openSyntheticLedgerWorker(directory);
 const started=await worker.ready; assert.ok(started.threadId>0);
 const write=worker.ingest(row()); const closing=worker.close();
 await assert.rejects(worker.get(id()),code('WORKER_CLOSED'));
 assert.equal(await write,'stored'); await closing; await worker.close();
 const db=openSyntheticLedger(directory); try {assert.equal(db.get(id()).outputTokens,4);} finally {db.close();}
});

test('queue rejects excess without dropping accepted operations', async()=>{
 const worker=openSyntheticLedgerWorker(dir(),1);
 try {
  const first=worker.ingest(row());
  await assert.rejects(worker.ingest(row(2,8)),code('QUEUE_FULL'));
  assert.equal(await first,'stored'); assert.equal((await worker.get(id())).outputTokens,4);
 } finally {await worker.close();}
});

test('input accessors and revoked proxy batches are refused before crossing threads', async()=>{
 const worker=openSyntheticLedgerWorker(dir());let invoked=false;
 try {
  const bad=row();Object.defineProperty(bad,'outputTokens',{get(){invoked=true;return 7;}});
  await assert.rejects(worker.ingest(bad),code('INVALID_INPUT'));assert.equal(invoked,false);
  const proxy=Proxy.revocable([row()],{});proxy.revoke();await assert.rejects(worker.ingestBatch(proxy.proxy),code('INVALID_INPUT'));
  assert.deepEqual(await worker.get(id()),{status:'unknown'});
 } finally {await worker.close();}
});

test('failed batch is rolled back and worker remains usable', async()=>{
 const worker=openSyntheticLedgerWorker(dir());
 try {
  assert.equal(await worker.ingest(row()),'stored');
  await assert.rejects(worker.ingestBatch([row(2,9),row(2,10)]),code('SEQUENCE_CONFLICT'));
  assert.equal((await worker.get(id())).outputTokens,4);
  assert.equal(await worker.ingest(row(2,11)),'stored');
 } finally {await worker.close();}
});

test('worker startup failures reject queued work and close without hanging', async()=>{
 const worker=openSyntheticLedgerWorker(join(dir(),'missing'));
 const write=worker.ingest(row());
 await assert.rejects(write); await assert.rejects(worker.ready); await assert.rejects(worker.close());
});

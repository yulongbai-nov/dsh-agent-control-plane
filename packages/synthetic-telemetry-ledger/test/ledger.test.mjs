import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSyntheticLedger } from '../index.mjs';

const key='a'.repeat(64), epoch='b'.repeat(64), other='c'.repeat(64);
const createDir=()=>{ const p=mkdtempSync(join(resolve(tmpdir()),'synthetic-ledger-')); chmodSync(p,0o700); return p; };
const row=(asOfSeq=1,outputTokens=4,sourceEpoch=epoch)=>({sessionKey:key,sourceEpoch,asOfSeq,outputTokens});
const id=(sourceEpoch=epoch)=>({sessionKey:key,sourceEpoch});
const errorCode=code=>e=>e.code===code;

test('stores and reopens observed values, with unknown distinct from zero', () => {
 const dir=createDir(); let db=openSyntheticLedger(dir);
 assert.equal(db.ingest(row(1,null)),'stored'); assert.deepEqual(db.get(id()),{status:'observed',asOfSeq:1,outputTokens:null,durable:'unknown'});
 db.close(); assert.equal(statSync(join(dir,'ledger.sqlite')).mode & 0o777,0o600);
 db=openSyntheticLedger(dir); assert.equal(db.ingest(row(2,0)),'stored'); db.close();
 db=openSyntheticLedger(dir); assert.equal(db.get(id()).outputTokens,0); db.close();
});

test('same sequence is idempotent; stale, conflicting and foreign epochs never overwrite', () => {
 const db=openSyntheticLedger(createDir());
 try {
  assert.equal(db.ingest(row()),'stored'); assert.equal(db.ingest(row()),'duplicate');
  assert.throws(()=>db.ingest(row(1,5)),errorCode('SEQUENCE_CONFLICT'));
  assert.throws(()=>db.ingest(row(0,1)),errorCode('STALE_SEQUENCE'));
  assert.throws(()=>db.ingest(row(2,7,other)),errorCode('SOURCE_EPOCH_CONFLICT'));
  assert.throws(()=>db.get(id(other)),errorCode('SOURCE_EPOCH_CONFLICT'));
  assert.equal(db.get(id()).outputTokens,4);
 } finally { db.close(); }
});

test('tombstones survive reopen and reject replay and new generation', () => {
 const dir=createDir(); let db=openSyntheticLedger(dir); db.ingest(row());
 assert.throws(()=>db.clear(id(other)),errorCode('SOURCE_EPOCH_CONFLICT')); assert.equal(db.clear(id()),'cleared'); db.close();
 db=openSyntheticLedger(dir); try {
  assert.equal(db.get(id()).status,'tombstoned'); assert.throws(()=>db.get(id(other)),errorCode('SOURCE_EPOCH_CONFLICT'));
  assert.throws(()=>db.clear(id(other)),errorCode('SOURCE_EPOCH_CONFLICT')); assert.throws(()=>db.ingest(row(9)),errorCode('TOMBSTONED'));
  assert.throws(()=>db.ingest(row(9,3,other)),errorCode('TOMBSTONED')); assert.equal(db.clear(id()),'already-cleared');
 } finally { db.close(); }
});

test('rejects extra fields, accessors, inherited fields, proxies and invalid numbers', () => {
 const db=openSyntheticLedger(createDir()); let ran=false;
 try {
  assert.throws(()=>db.ingest({...row(),prompt:'private'}),errorCode('INVALID_INPUT'));
  const v=row(); Object.defineProperty(v,'outputTokens',{get(){ran=true;return 2;}});
  assert.throws(()=>db.ingest(v),errorCode('INVALID_INPUT')); assert.equal(ran,false);
  assert.throws(()=>db.ingest(Object.create(row())),errorCode('INVALID_INPUT'));
  assert.throws(()=>db.ingest(new Proxy(row(),{})),errorCode('INVALID_INPUT'));
  for(const n of [-1,1.2,Number.MAX_SAFE_INTEGER+1,NaN]) assert.throws(()=>db.ingest(row(1,n)),errorCode('INVALID_INPUT'));
 } finally { db.close(); }
});

test('rejects symlinks, unsafe modes and unsupported database schema', () => {
 const dir=createDir(), target=join(dir,'target'); writeFileSync(target,'test',{mode:0o600}); symlinkSync(target,join(dir,'ledger.sqlite'));
 assert.throws(()=>openSyntheticLedger(dir),errorCode('UNSAFE_FILE'));
 const unsafe=createDir(); chmodSync(unsafe,0o755); assert.throws(()=>openSyntheticLedger(unsafe),errorCode('UNSAFE_DIRECTORY'));
 const unsupported=createDir(), path=join(unsupported,'ledger.sqlite'); const raw=new DatabaseSync(path); raw.exec('PRAGMA user_version=9'); raw.close(); chmodSync(path,0o600);
 assert.throws(()=>openSyntheticLedger(unsupported),errorCode('UNSUPPORTED_SCHEMA'));
});

test('rejects a same-version schema that omits identity constraints', () => {
 const dir=createDir(), path=join(dir,'ledger.sqlite');
 const raw=new DatabaseSync(path);
 raw.exec('CREATE TABLE snapshots (session_key TEXT, source_epoch TEXT, seq INTEGER, output_tokens INTEGER); CREATE TABLE tombstones (session_key TEXT, source_epoch TEXT, seq INTEGER); PRAGMA user_version=1');
 raw.close(); chmodSync(path,0o600);
 assert.throws(()=>openSyntheticLedger(dir),errorCode('UNSUPPORTED_SCHEMA'));
});

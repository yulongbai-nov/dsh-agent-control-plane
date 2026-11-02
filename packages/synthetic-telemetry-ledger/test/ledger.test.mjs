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

test('batch conflict rolls back all snapshots and cursors', () => {
 const db=openSyntheticLedger(createDir()), second='d'.repeat(64);
 try {
  db.ingest(row());
  assert.throws(()=>db.ingestBatch([{...row(1,7),sessionKey:second},row(1,9)]),errorCode('SEQUENCE_CONFLICT'));
  assert.deepEqual(db.get({sessionKey:second,sourceEpoch:epoch}),{status:'unknown'});
  assert.equal(db.get(id()).outputTokens,4);
  assert.deepEqual(db.ingestBatch([{...row(1,7),sessionKey:second},row(2,9)]),['stored','stored']);
 } finally { db.close(); }
});

test('v1 migration restores observed cursor only, never durable-source proof', () => {
 const dir=createDir(), path=join(dir,'ledger.sqlite');
 const raw=new DatabaseSync(path);
 raw.exec('CREATE TABLE snapshots (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL, output_tokens INTEGER); CREATE TABLE tombstones (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL); PRAGMA user_version=1');
 raw.prepare('INSERT INTO snapshots VALUES (?,?,?,?)').run(key,epoch,3,8); raw.close(); chmodSync(path,0o600);
 const db=openSyntheticLedger(dir);
 try { assert.deepEqual(db.get(id()),{status:'observed',asOfSeq:3,outputTokens:8,durable:'unknown'}); } finally { db.close(); }
 const inspect=new DatabaseSync(path); try { assert.equal(inspect.prepare('PRAGMA user_version').get().user_version,2); assert.equal(inspect.prepare('SELECT seq FROM source_cursors').get().seq,3); } finally { inspect.close(); }
});

test('reopen fails closed if stored cursor and snapshot disagree', () => {
 const dir=createDir(); let db=openSyntheticLedger(dir); db.ingest(row()); db.close();
 const raw=new DatabaseSync(join(dir,'ledger.sqlite')); raw.prepare('UPDATE source_cursors SET seq=2 WHERE session_key=?').run(key); raw.close();
 assert.throws(()=>openSyntheticLedger(dir),errorCode('CURSOR_INCONSISTENT'));
});

test('SQLite transaction interrupted before commit rolls back on reopen', async () => {
 const { spawnSync }=await import('node:child_process');
 const dir=createDir(); let db=openSyntheticLedger(dir); db.ingest(row()); db.close();
 const code=`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');db.prepare('UPDATE snapshots SET seq=2, output_tokens=9').run();process.exit(73)`;
 const child=spawnSync(process.execPath,['-e',code,join(dir,'ledger.sqlite')],{timeout:5000,encoding:'utf8'});
 assert.equal(child.status,73,child.stderr); db=openSyntheticLedger(dir);
 try { assert.equal(db.get(id()).asOfSeq,1); assert.equal(db.get(id()).outputTokens,4); } finally { db.close(); }
});

test('two instances racing the same sequence cannot overwrite each other', async () => {
 const { Worker }=await import('node:worker_threads');
 const dir=createDir(); const initial=openSyntheticLedger(dir); initial.close();
 const workers=[3,7].map(n=>new Worker(new URL('./ledger-worker.mjs',import.meta.url),{workerData:{directory:dir,record:row(1,n)}}));
 try {
  const ready=workers.map(worker=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('worker ready timeout')),5000);
   worker.once('error',reject); worker.once('message',m=>{clearTimeout(timer); m.ready ? resolve() : reject(Error(m.openError ?? 'worker failed'));});
  }));
  await Promise.all(ready);
  const results=workers.map(worker=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('worker result timeout')),5000);
   worker.once('error',reject); worker.once('message',m=>{clearTimeout(timer);resolve(m);});
  }));
  for(const worker of workers) worker.postMessage('go');
  const out=await Promise.all(results); assert.equal(out.filter(x=>x.result==='stored').length,1); assert.equal(out.filter(x=>x.error==='SEQUENCE_CONFLICT').length,1);
  const db=openSyntheticLedger(dir); try { assert.ok([3,7].includes(db.get(id()).outputTokens)); } finally { db.close(); }
 } finally { await Promise.all(workers.map(worker=>worker.terminate())); }
});

test('v1 migration rejects contradictory tombstone without modifying schema', () => {
 const dir=createDir(), path=join(dir,'ledger.sqlite'), raw=new DatabaseSync(path);
 raw.exec('CREATE TABLE snapshots (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL, output_tokens INTEGER); CREATE TABLE tombstones (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL); PRAGMA user_version=1');
 raw.prepare('INSERT INTO snapshots VALUES (?,?,?,?)').run(key,epoch,1,5); raw.prepare('INSERT INTO tombstones VALUES (?,?,?)').run(key,epoch,1); raw.close(); chmodSync(path,0o600);
 assert.throws(()=>openSyntheticLedger(dir),errorCode('CURSOR_INCONSISTENT'));
 const inspect=new DatabaseSync(path); try { assert.equal(inspect.prepare('PRAGMA user_version').get().user_version,1); assert.equal(inspect.prepare("SELECT 1 FROM sqlite_master WHERE name='source_cursors'").get(),undefined); } finally { inspect.close(); }
});

test('batch validation rejects sparse or accessor arrays before any write', () => {
 const db=openSyntheticLedger(createDir()); let invoked=false;
 try {
  const input=[row(),row(2,5)]; Object.defineProperty(input,'1',{get(){invoked=true;return row(2,5);}});
  assert.throws(()=>db.ingestBatch(input),errorCode('INVALID_INPUT')); assert.equal(invoked,false); assert.equal(db.get(id()).status,'unknown');
  assert.throws(()=>db.ingestBatch(Array(1)),errorCode('INVALID_INPUT'));
  assert.throws(()=>db.ingest(row(-0,5)),errorCode('INVALID_INPUT')); assert.throws(()=>db.ingest(row(1,-0)),errorCode('INVALID_INPUT'));
 } finally { db.close(); }
});

test('revoked proxy array is rejected without leaking a TypeError', () => {
 const db=openSyntheticLedger(createDir()); const proxy=Proxy.revocable([row()],{}); proxy.revoke();
 try { assert.throws(()=>db.ingestBatch(proxy.proxy),errorCode('INVALID_INPUT')); } finally { db.close(); }
});

test('sqlite-like name is an unexpected table, not a reserved sqlite_ name', () => {
 const dir=createDir(); let db=openSyntheticLedger(dir); db.close(); const path=join(dir,'ledger.sqlite');
 const raw=new DatabaseSync(path); raw.exec('CREATE TABLE sqliteXbad(x)'); raw.close();
 assert.throws(()=>openSyntheticLedger(dir),errorCode('UNSUPPORTED_SCHEMA'));
});

test('two workers can concurrently open and migrate the same v1 database', async () => {
 const { Worker }=await import('node:worker_threads');
 const dir=createDir(), path=join(dir,'ledger.sqlite'), raw=new DatabaseSync(path);
 raw.exec('CREATE TABLE snapshots (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL, output_tokens INTEGER); CREATE TABLE tombstones (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL); PRAGMA user_version=1'); raw.close(); chmodSync(path,0o600);
 const workers=[3,7].map((n,i)=>new Worker(new URL('./ledger-worker.mjs',import.meta.url),{workerData:{directory:dir,record:{...row(1,n),sessionKey:(i?'d':'e').repeat(64)}}}));
 try {
  const ready=workers.map(worker=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('worker ready timeout')),5000);
   worker.once('error',reject); worker.once('message',m=>{clearTimeout(timer);m.ready ? resolve() : reject(Error(m.openError ?? 'worker failed'));});
  }));
  await Promise.all(ready);
  const results=workers.map(worker=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('worker result timeout')),5000);
   worker.once('error',reject); worker.once('message',m=>{clearTimeout(timer);resolve(m);});
  }));
  for(const worker of workers) worker.postMessage('go');
  assert.deepEqual(await Promise.all(results),[{result:'stored'},{result:'stored'}]);
  const db=openSyntheticLedger(dir); db.close();
 } finally { await Promise.all(workers.map(worker=>worker.terminate())); }
});

test('reopen rejects malformed persisted rows even when schema and cursor match', () => {
 const cases=[
  ["session_key=NULL", "session_key=NULL"],
  ["session_key='short'", "session_key='short'"],
  ["session_key='"+'a'.repeat(64)+"'||char(0)||'x'", "session_key='"+'a'.repeat(64)+"'||char(0)||'x'"],
  ["session_key=X'616263'", "session_key=X'616263'"],
  ["session_key='"+'A'.repeat(64)+"'", "session_key='"+'A'.repeat(64)+"'"],
  ["source_epoch='bad'", "source_epoch='bad'"],
  ['seq=-1', 'seq=-1'], ['seq=1.5', 'seq=1.5'],
  ['seq=9007199254740992', 'seq=9007199254740992'],
  ['output_tokens=-1', null], ['output_tokens=1.5', null],
  ['output_tokens=9007199254740992', null], ["output_tokens='bad'", null],
 ];
 for (const [snapshotChange,cursorChange] of cases) {
  const dir=createDir(), path=join(dir,'ledger.sqlite'); let db=openSyntheticLedger(dir); db.ingest(row()); db.close();
  const raw=new DatabaseSync(path); raw.exec('UPDATE snapshots SET '+snapshotChange); if(cursorChange) raw.exec('UPDATE source_cursors SET '+cursorChange); raw.close();
  assert.throws(()=>openSyntheticLedger(dir),errorCode('INVALID_STORED_DATA'),snapshotChange);
 }
});

test('malformed tombstone and cursor rows fail closed', () => {
 for(const [table,sql] of [['tombstones',"UPDATE tombstones SET source_epoch='bad'"],['source_cursors','UPDATE source_cursors SET seq=9007199254740992']]) {
  const dir=createDir(), path=join(dir,'ledger.sqlite'); let db=openSyntheticLedger(dir); db.ingest(row()); if(table==='tombstones') db.clear(id()); db.close();
  const raw=new DatabaseSync(path); raw.exec(sql); raw.close(); assert.throws(()=>openSyntheticLedger(dir),errorCode('INVALID_STORED_DATA'),table);
 }
});

test('v1 malformed snapshot is rejected before migration', () => {
 const dir=createDir(), path=join(dir,'ledger.sqlite'); const raw=new DatabaseSync(path);
 raw.exec("CREATE TABLE snapshots (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL, output_tokens INTEGER); CREATE TABLE tombstones (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL); PRAGMA user_version=1; INSERT INTO snapshots VALUES ('bad','bad',-1,0)"); raw.close(); chmodSync(path,0o600);
 assert.throws(()=>openSyntheticLedger(dir),errorCode('INVALID_STORED_DATA'));
 const check=new DatabaseSync(path);try {assert.equal(check.prepare('PRAGMA user_version').get().user_version,1);assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name='source_cursors'").get(),undefined);} finally {check.close();}
});

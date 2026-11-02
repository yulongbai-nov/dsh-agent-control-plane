import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createWorkerController, normalizeWorkerTimeouts } from '../worker-controller.mjs';
const deadlines={startupMs:100,operationMs:70,closeMs:70};
const code=expected=>e=>e.code===expected;
class Fake extends EventEmitter {
 terminated=0; sent=[];
 postMessage(message) { this.sent.push(message); }
 terminate() { this.terminated++; this.emit('exit',1); return Promise.resolve(1); }
}
function onReady(worker){ queueMicrotask(()=>worker.emit('message',{type:'ready',threadId:9})); }

test('startup timeout rejects a never-dispatched write as NOT_SENT',async()=>{
 const worker=new Fake(), ctl=createWorkerController(worker,4,{...deadlines,startupMs:20});
 const result=ctl.submit('ingest',{}); await assert.rejects(result,e=>e.code==='WORKER_START_TIMEOUT'&&e.outcome==='NOT_SENT');
 await assert.rejects(ctl.ready,code('WORKER_START_TIMEOUT')); assert.equal(worker.terminated,1);assert.deepEqual(worker.sent,[]);
});

test('operation timeout terminates worker and marks all dispatched writes UNKNOWN',async()=>{
 const worker=new Fake(),ctl=createWorkerController(worker,4,deadlines);onReady(worker);await ctl.ready;
 const first=ctl.submit('ingest',{}),second=ctl.submit('clear',{});
 const firstCheck=assert.rejects(first,e=>e.code==='WRITE_OUTCOME_UNKNOWN'&&e.outcome==='UNKNOWN'&&e.reason==='OPERATION_TIMEOUT');
 const secondCheck=assert.rejects(second,e=>e.code==='WRITE_OUTCOME_UNKNOWN'&&e.outcome==='UNKNOWN'&&e.reason==='OPERATION_TIMEOUT');
 await Promise.all([firstCheck,secondCheck]);assert.equal(worker.terminated,1);assert.equal(worker.sent.filter(x=>x.type==='request').length,2);
});

test('known rollback error is distinct from ambiguous database failure',async()=>{
 const worker=new Fake(),ctl=createWorkerController(worker,2,deadlines);onReady(worker);await ctl.ready;
 const known=ctl.submit('ingest',{});await Promise.resolve();worker.emit('message',{type:'result',id:1,error:'SEQUENCE_CONFLICT'});await assert.rejects(known,code('SEQUENCE_CONFLICT'));
 const unknown=ctl.submit('ingest',{});await Promise.resolve();worker.emit('message',{type:'result',id:2,error:'ERR_SQLITE_ERROR'});
 await assert.rejects(unknown,e=>e.code==='WRITE_OUTCOME_UNKNOWN'&&e.reason==='ERR_SQLITE_ERROR'&&e.outcome==='UNKNOWN');worker.emit('exit',1);
});

test('close deadline rejects and terminates when worker does not exit',async()=>{
 const worker=new Fake(),ctl=createWorkerController(worker,1,{...deadlines,closeMs:20});onReady(worker);await ctl.ready;
 await assert.rejects(ctl.close(),code('WORKER_CLOSE_TIMEOUT'));assert.equal(worker.terminated,1);
});

test('a real hung worker is terminated and in-flight write outcome stays UNKNOWN',async()=>{
 const worker=new Worker(new URL('./hang-worker.mjs',import.meta.url),{env:{PATH:'/usr/bin:/bin'}});
 const terminated=new Promise(resolve=>worker.once('exit',resolve));
 const ctl=createWorkerController(worker,1,{startupMs:5000,operationMs:100,closeMs:1000});await ctl.ready;
 await assert.rejects(ctl.submit('ingest',{}),e=>e.code==='WRITE_OUTCOME_UNKNOWN'&&e.reason==='OPERATION_TIMEOUT'&&e.outcome==='UNKNOWN');
 assert.equal(await terminated,1);
});

test('timeout options reject getters, revoked proxies and unreasonable values',()=>{
 let called=false;const bad={};Object.defineProperty(bad,'startupMs',{get(){called=true;return 20;},enumerable:true});
 assert.throws(()=>normalizeWorkerTimeouts(bad),code('INVALID_INPUT'));assert.equal(called,false);
 const proxy=Proxy.revocable({},{});proxy.revoke();assert.throws(()=>normalizeWorkerTimeouts(proxy.proxy),code('INVALID_INPUT'));
 for(const value of [0,9,60001,1.5])assert.throws(()=>normalizeWorkerTimeouts({closeMs:value}),code('INVALID_INPUT'));
});

test('close deadline marks dispatched writes UNKNOWN before returning',async()=>{
 const worker=new Fake(),ctl=createWorkerController(worker,1,{startupMs:100,operationMs:1000,closeMs:20});onReady(worker);await ctl.ready;
 const write=ctl.submit('ingest',{});await Promise.resolve();
 const pending=assert.rejects(write,e=>e.code==='WRITE_OUTCOME_UNKNOWN'&&e.reason==='WORKER_CLOSE_TIMEOUT'&&e.outcome==='UNKNOWN');
 await assert.rejects(ctl.close(),code('WORKER_CLOSE_TIMEOUT'));await pending;assert.equal(worker.terminated,1);
});

test('unexpected worker exit marks a dispatched write UNKNOWN',async()=>{
 const worker=new Fake(),ctl=createWorkerController(worker,1,deadlines);onReady(worker);await ctl.ready;
 const write=ctl.submit('ingest',{});await Promise.resolve();worker.emit('exit',1);
 await assert.rejects(write,e=>e.code==='WRITE_OUTCOME_UNKNOWN'&&e.reason==='WORKER_EXITED'&&e.outcome==='UNKNOWN');
});

test('a committed write with lost reply remains UNKNOWN and is never retried',async()=>{
 const { mkdtempSync,chmodSync }=await import('node:fs'),{tmpdir}=await import('node:os'),{join,resolve}=await import('node:path');
 const { openSyntheticLedger }=await import('../index.mjs');
 const dir=mkdtempSync(join(resolve(tmpdir()),'lost-receipt-'));chmodSync(dir,0o700);
 const worker=new Worker(new URL('./commit-then-hang-worker.mjs',import.meta.url),{workerData:{directory:dir},env:{PATH:'/usr/bin:/bin'}});
 const terminated=new Promise(resolve=>worker.once('exit',resolve));
 const ctl=createWorkerController(worker,1,{startupMs:5000,operationMs:200,closeMs:1000});await ctl.ready;
 const sessionKey='a'.repeat(64),sourceEpoch='b'.repeat(64),row={sessionKey,sourceEpoch,asOfSeq:1,outputTokens:8};
 await assert.rejects(ctl.submit('ingest',row),e=>e.code==='WRITE_OUTCOME_UNKNOWN'&&e.outcome==='UNKNOWN');
 await terminated; const db=openSyntheticLedger(dir);
 try {assert.equal(db.get({sessionKey,sourceEpoch}).outputTokens,8);} finally {db.close();}
});

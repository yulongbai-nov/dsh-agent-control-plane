import { Worker } from 'node:worker_threads';
import { normalizeSyntheticSnapshot, normalizeSyntheticIdentity, normalizeSyntheticBatch } from './index.mjs';

const problem = code => Object.assign(new Error(code), { code });

/** Bounded, synthetic-only worker facade. A worker is not a security boundary. */
export function openSyntheticLedgerWorker(directory, maxPending = 16) {
  if (typeof directory !== 'string' || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 64) throw problem('INVALID_INPUT');
  const worker = new Worker(new URL('./worker-runtime.mjs', import.meta.url), { workerData:{directory}, env:{PATH:'/usr/bin:/bin'} });
  let state='open', failure, nextId=0, resolveReady, rejectReady, resolveExit;
  const pending = new Map(), idleWaiters = [];
  const ready = new Promise((resolve,reject) => { resolveReady=resolve; rejectReady=reject; });
  ready.catch(() => {}); // Startup failure is surfaced by ready and every queued request.
  const exited = new Promise(resolve => { resolveExit=resolve; });
  const notifyIdle = () => { if (pending.size === 0) for (const done of idleWaiters.splice(0)) done(); };
  const abort = code => {
    if (failure) return;
    failure=problem(code); rejectReady(failure);
    for (const request of pending.values()) request.reject(failure);
    pending.clear(); notifyIdle();
    // A protocol or startup failure must not leave an owned worker behind.
    void worker.terminate().catch(() => {});
  };
  worker.on('message', message => {
    if (message?.type === 'ready' && Number.isSafeInteger(message.threadId) && message.threadId > 0) { resolveReady({threadId:message.threadId}); return; }
    if (message?.type === 'fatal') { abort(typeof message.code === 'string' ? message.code : 'WORKER_FAILED'); return; }
    if (message?.type !== 'result' || !pending.has(message.id)) { abort('INVALID_WORKER_RESPONSE'); return; }
    const request=pending.get(message.id); pending.delete(message.id);
    if (message.error) request.reject(problem(message.error)); else request.resolve(message.result);
    notifyIdle();
  });
  worker.on('error', () => abort('WORKER_FAILED'));
  worker.on('exit', code => {
    if (state !== 'closing' || code !== 0 || pending.size) abort('WORKER_EXITED');
    state='closed'; resolveExit();
  });
  function submit(operation, input, normalize) {
    if (state !== 'open') return Promise.reject(problem('WORKER_CLOSED'));
    if (failure) return Promise.reject(failure);
    let value;
    try { value=normalize(input); } catch(error) { return Promise.reject(error); }
    if (pending.size >= maxPending) return Promise.reject(problem('QUEUE_FULL'));
    if (nextId >= Number.MAX_SAFE_INTEGER) return Promise.reject(problem('REQUEST_LIMIT'));
    const id=++nextId;
    const result=new Promise((resolve,reject) => pending.set(id,{resolve,reject}));
    ready.then(() => {
      if (!pending.has(id)) return;
      try { worker.postMessage({type:'request',id,operation,value}); } catch { abort('WORKER_SEND_FAILED'); }
    }, () => {});
    return result;
  }
  let closing;
  return {
    ready,
    ingest: value => submit('ingest',value,normalizeSyntheticSnapshot),
    ingestBatch: value => submit('ingestBatch',value,normalizeSyntheticBatch),
    get: value => submit('get',value,normalizeSyntheticIdentity),
    clear: value => submit('clear',value,normalizeSyntheticIdentity),
    close() {
      if (closing) return closing;
      if (state === 'closed') return failure ? Promise.reject(failure) : Promise.resolve();
      state='closing';
      closing=(async () => {
        if (pending.size) await new Promise(resolve => idleWaiters.push(resolve));
        try { await ready; if (failure) throw failure; worker.postMessage({type:'close'}); await exited; if (failure) throw failure; }
        catch (error) { await worker.terminate(); await exited; throw error; }
      })();
      return closing;
    },
  };
}

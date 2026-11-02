// Internal orchestration for the synthetic ledger worker; it is not a security boundary.
import { types } from 'node:util';
const problem = (code, extra={}) => Object.assign(new Error(code), { code, ...extra });
const writes = new Set(['ingest','ingestBatch','clear']);
const rolledBack = new Set(['INVALID_INPUT','TOMBSTONED','SOURCE_EPOCH_CONFLICT','STALE_SEQUENCE','SEQUENCE_CONFLICT','UNKNOWN_SESSION','UNSUPPORTED_SCHEMA','INVALID_STORED_DATA','CURSOR_INCONSISTENT']);

export function normalizeWorkerTimeouts(input) {
  const defaults={startupMs:15000,operationMs:30000,closeMs:10000};
  if (input === undefined) return defaults;
  if (!input || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw problem('INVALID_INPUT');
  for(const key of Reflect.ownKeys(input)) {
    if(typeof key !== 'string' || !Object.hasOwn(defaults,key)) throw problem('INVALID_INPUT');
    const descriptor=Object.getOwnPropertyDescriptor(input,key);
    if(!descriptor || !Object.hasOwn(descriptor,'value') || !Number.isSafeInteger(descriptor.value) || descriptor.value<10 || descriptor.value>60000) throw problem('INVALID_INPUT');
    defaults[key]=descriptor.value;
  }
  return defaults;
}

export function createWorkerController(worker, maxPending, timeouts) {
  let state='open', failure, nextId=0, resolveReady, rejectReady, resolveExit, readySeen=false;
  const pending = new Map(), idleWaiters = [];
  const ready = new Promise((resolve,reject) => { resolveReady=resolve; rejectReady=reject; });
  ready.catch(() => {});
  const exited = new Promise(resolve => { resolveExit=resolve; });
  const notifyIdle = () => { if (pending.size === 0) for (const done of idleWaiters.splice(0)) done(); };
  let startupTimer;
  const requestFailure = (request, reason) => {
    if (!writes.has(request.operation)) return problem(reason);
    return request.sent ? problem('WRITE_OUTCOME_UNKNOWN',{outcome:'UNKNOWN',reason}) : problem(reason,{outcome:'NOT_SENT'});
  };
  const abort = reason => {
    if (failure) return;
    failure=problem(reason); clearTimeout(startupTimer); rejectReady(failure);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(requestFailure(request,reason)); }
    pending.clear(); notifyIdle();
    try { Promise.resolve(worker.terminate()).catch(() => {}); } catch {}
  };
  startupTimer=setTimeout(()=>abort('WORKER_START_TIMEOUT'),timeouts.startupMs);
  worker.on('message', message => {
    if (message?.type === 'ready' && !readySeen && Number.isSafeInteger(message.threadId) && message.threadId > 0) {
      readySeen=true; clearTimeout(startupTimer); resolveReady({threadId:message.threadId}); return;
    }
    if (message?.type === 'fatal') { abort(typeof message.code === 'string' ? message.code : 'WORKER_FAILED'); return; }
    if (message?.type !== 'result' || !pending.has(message.id)) { abort('INVALID_WORKER_RESPONSE'); return; }
    const request=pending.get(message.id); pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) {
      const reason=typeof message.error === 'string' ? message.error : 'OPERATION_FAILED';
      request.reject(writes.has(request.operation) && !rolledBack.has(reason) ? problem('WRITE_OUTCOME_UNKNOWN',{outcome:'UNKNOWN',reason}) : problem(reason));
    } else request.resolve(message.result);
    notifyIdle();
  });
  worker.on('error', () => abort('WORKER_FAILED'));
  worker.on('exit', code => {
    clearTimeout(startupTimer);
    if (state !== 'closing' || code !== 0 || pending.size) abort('WORKER_EXITED');
    state='closed'; resolveExit();
  });
  function submit(operation, value) {
    if (state !== 'open') return Promise.reject(problem('WORKER_CLOSED'));
    if (failure) return Promise.reject(failure);
    if (pending.size >= maxPending) return Promise.reject(problem('QUEUE_FULL'));
    if (nextId >= Number.MAX_SAFE_INTEGER) return Promise.reject(problem('REQUEST_LIMIT'));
    const id=++nextId;
    const result=new Promise((resolve,reject) => pending.set(id,{resolve,reject,operation,sent:false,timer:setTimeout(()=>abort('OPERATION_TIMEOUT'),timeouts.operationMs)}));
    ready.then(() => {
      if (!pending.has(id)) return;
      pending.get(id).sent=true; // Conservative even if postMessage itself subsequently throws.
      try { worker.postMessage({type:'request',id,operation,value}); } catch { abort('WORKER_SEND_FAILED'); }
    }, () => {});
    return result;
  }
  let closing;
  function close() {
    if (closing) return closing;
    if (state === 'closed') return failure ? Promise.reject(failure) : Promise.resolve();
    state='closing';
    closing=new Promise((resolve,reject) => {
      let settled=false;
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
      const timer=setTimeout(()=>{abort('WORKER_CLOSE_TIMEOUT');finish(problem('WORKER_CLOSE_TIMEOUT'));},timeouts.closeMs);
      (async () => {
        try {
          if (pending.size) await new Promise(done => idleWaiters.push(done));
          await ready; if(failure) throw failure;
          worker.postMessage({type:'close'}); await exited;
          if(failure) throw failure; finish();
        } catch(error) { abort('WORKER_CLOSE_FAILED'); finish(error); }
      })();
    });
    return closing;
  }
  return {ready,submit,close};
}

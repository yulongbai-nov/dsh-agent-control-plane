import { Worker } from 'node:worker_threads';
import { normalizeSyntheticSnapshot, normalizeSyntheticIdentity, normalizeSyntheticBatch } from './index.mjs';
import { createWorkerController, normalizeWorkerTimeouts } from './worker-controller.mjs';
const problem = code => Object.assign(new Error(code), { code });

/** Bounded, synthetic-only worker facade. A worker is not a security boundary. */
export function openSyntheticLedgerWorker(directory, maxPending = 16, timeoutOptions) {
  if (typeof directory !== 'string' || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 64) throw problem('INVALID_INPUT');
  const timeouts=normalizeWorkerTimeouts(timeoutOptions);
  const worker=new Worker(new URL('./worker-runtime.mjs',import.meta.url),{workerData:{directory},env:{PATH:'/usr/bin:/bin'}});
  const controller=createWorkerController(worker,maxPending,timeouts);
  function submit(operation,input,normalize) {
    try { return controller.submit(operation,normalize(input)); }
    catch(error) { return Promise.reject(error); }
  }
  return {
    ready:controller.ready,
    ingest:value=>submit('ingest',value,normalizeSyntheticSnapshot),
    ingestBatch:value=>submit('ingestBatch',value,normalizeSyntheticBatch),
    get:value=>submit('get',value,normalizeSyntheticIdentity),
    clear:value=>submit('clear',value,normalizeSyntheticIdentity),
    close:controller.close,
  };
}

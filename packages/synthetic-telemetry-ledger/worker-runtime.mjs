import { parentPort, workerData, threadId } from 'node:worker_threads';
import { openSyntheticLedger } from './index.mjs';

let ledger;
try {
  ledger = openSyntheticLedger(workerData.directory);
  parentPort.postMessage({ type: 'ready', threadId });
  parentPort.on('message', message => {
    if (message.type === 'close') {
      try { ledger.close(); parentPort.close(); }
      catch { parentPort.postMessage({ type: 'fatal', code: 'WORKER_CLOSE_FAILED' }); parentPort.close(); }
      return;
    }
    if (message.type !== 'request' || !Number.isSafeInteger(message.id) || !['ingest','ingestBatch','get','clear'].includes(message.operation)) {
      parentPort.postMessage({ type: 'fatal', code: 'INVALID_WORKER_MESSAGE' });
      try { ledger.close(); } finally { parentPort.close(); }
      return;
    }
    try { parentPort.postMessage({ type:'result', id:message.id, result:ledger[message.operation](message.value) }); }
    catch (error) { parentPort.postMessage({ type:'result', id:message.id, error:typeof error?.code === 'string' ? error.code : 'OPERATION_FAILED' }); }
  });
} catch (error) {
  parentPort.postMessage({ type:'fatal', code:typeof error?.code === 'string' ? error.code : 'WORKER_START_FAILED' });
  parentPort.close();
}

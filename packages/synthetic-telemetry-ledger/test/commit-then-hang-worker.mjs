// Synthetic receipt-loss test: commit a fixture record, then never send its result.
import { parentPort, threadId, workerData } from 'node:worker_threads';
import { openSyntheticLedger } from '../index.mjs';
const db=openSyntheticLedger(workerData.directory);
parentPort.postMessage({type:'ready',threadId});
parentPort.on('message', message => {
 if(message.type==='request') { db.ingest(message.value); while(true) {} }
});

// Synthetic test worker: it never opens a database or accesses external services.
import { parentPort, threadId } from 'node:worker_threads';
parentPort.postMessage({type:'ready',threadId});
parentPort.on('message', message => { if (message.type==='request') { while(true) {} } });

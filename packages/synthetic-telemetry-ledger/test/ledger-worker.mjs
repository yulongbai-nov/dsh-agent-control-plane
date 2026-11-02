import { parentPort, workerData } from 'node:worker_threads';
import { openSyntheticLedger } from '../index.mjs';
let db;
try {
 db=openSyntheticLedger(workerData.directory); parentPort.postMessage({ready:true});
 parentPort.once('message',()=>{
  try { parentPort.postMessage({result:db.ingest(workerData.record)}); }
  catch(e) { parentPort.postMessage({error:e.code}); }
  finally { db.close(); }
 });
} catch(e) { if(db) db.close(); parentPort.postMessage({openError:e.code ?? e.message}); }

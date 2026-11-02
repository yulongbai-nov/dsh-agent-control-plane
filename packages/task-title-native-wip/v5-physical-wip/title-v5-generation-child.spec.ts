/** Subprocess fixture; parent provides only a fresh task-owned root. */
import { it } from 'vitest'
import { readFile,stat,writeFile,access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { createJsonlGenerationRuntime } from '../src/generation.ts'
import { experimentalV5Catalog } from '../../../../synthetic-title-migration-wip/v5-codec.ts'
const root=process.env.R9_SYNTHETIC_ROOT,mode=process.env.R9_MODE,worker=process.env.R9_WORKER
it.skipIf(!root||!mode||!worker)('runs only the parent-authorized synthetic generation',async()=>{
 if(!root||!mode||!worker)throw Error('missing fixture configuration')
 const format={currentVersion:5,createRestore:(h:any)=>experimentalV5Catalog.createRestore(h,{recovery:'strict',validation:'current'}),encodeHeader:(h:any,n:number)=>({...releasedV4SessionFormatCodec.encodeHeader({...h,version:4},n),version:5}),encodeEvent:(e:any)=>releasedV4SessionFormatCodec.encodeEvent(e)}
 const verify=async(path:string,_c:unknown,id:string,count:number)=>{const [bytes,identity]=await Promise.all([readFile(path),stat(path,{bigint:true})]);const rows=bytes.toString().trimEnd().split('\n').map(x=>JSON.parse(x));const r=experimentalV5Catalog.createRestore(rows[0],{recovery:'strict',validation:'current'});for(const row of rows.slice(1))r.decodeRow(row);const a=r.finish();if(a.header.id!==id||a.events.length!==count)throw Error('mismatch');return {identity,bytes:bytes.length,digest:createHash('sha256').update(bytes).digest('hex')}}
 const runtime=createJsonlGenerationRuntime({barrier:async phase=>{if(phase===mode){await writeFile(join(root,`barrier-${worker}`),'ready');for(;;)await delay(1000)}}})
 const p=await runtime.prepare({sourcePath:join(root,'session.v4.jsonl'),sourceVersion:4,currentPath:join(root,'session.v5.jsonl'),compression:'none',format,verifyCurrentFile:verify})
 if(mode==='race'){await writeFile(join(root,`ready-${worker}`),'ready');let released=false;for(let i=0;i<500;i++){try{await access(join(root,'release'));released=true;break}catch{await delay(20)}}if(!released)throw Error('release timeout')}
 await p.publish()
},30000)

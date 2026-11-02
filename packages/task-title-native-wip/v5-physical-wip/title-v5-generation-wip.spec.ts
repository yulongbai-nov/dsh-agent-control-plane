/** Synthetic-only lower-level JSONL generation with experimental catalog and local verifier. */
import { describe,expect,it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { mkdtemp,readFile,rm,stat,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareJsonlMigration } from '../src/generation.ts'
import { generationLogPath } from '../src/format.ts'
import { experimentalV5Catalog } from '../../../../synthetic-title-migration-wip/v5-codec.ts'
const toV4=(h:any)=>({...h,version:4})
const format={currentVersion:5,createRestore:(h:any)=>experimentalV5Catalog.createRestore(h,{recovery:'strict',validation:'current'}),encodeHeader:(h:any,n:number)=>({...releasedV4SessionFormatCodec.encodeHeader(toV4(h),n),version:5}),encodeEvent:(e:any)=>releasedV4SessionFormatCodec.encodeEvent(e)}
// In-process test verifier: NOT the actual isolated JSONL worker verifier, which is pinned to V4.
const verify=async(path:string,_compression:unknown,id:string,count:number)=>{
 const [bytes,identity]=await Promise.all([readFile(path),stat(path,{bigint:true})]);const lines=bytes.toString().trimEnd().split('\n').map(x=>JSON.parse(x));const r=experimentalV5Catalog.createRestore(lines[0],{recovery:'strict',validation:'current'});for(const line of lines.slice(1))r.decodeRow(line);const artifact=r.finish();if(artifact.header.id!==id||artifact.events.length!==count)throw Error('mismatch');return {identity,bytes:bytes.length,digest:createHash('sha256').update(bytes).digest('hex')}
}
describe('synthetic V5 JSONL generation experiment',()=>{
 it('uses actual V4 writer and generation publisher, keeps source, and rejects V5 in old reader',async()=>{
  const root=await mkdtemp(join(tmpdir(),'title-v5-gen-'));const ctx=new Context();const id=SessionId('synthetic-title')
  try {
   await ctx.plugin(JsonlPersistence,{root,compression:'none'});const write=await ctx.sessionPersistence.create({version:SESSION_FORMAT_VERSION,id,createdAt:1,isSeeded:false,delegationDepth:0,parentSession:SessionId('synthetic-parent')})
   await write.append([{type:'session/title',seq:SessionSeq(0),time:1,data:{title:'Synthetic',messageSeqs:[],source:{kind:'user'}}},{type:'plugin:synthetic',seq:SessionSeq(1),time:2,data:{value:'opaque'},ignorable:true} as never]);await write.flush();await write.close()
   const old=generationLogPath(root,undefined,id,4,'none'), target=generationLogPath(root,undefined,id,5,'none'), original=await readFile(old)
   const options={sourcePath:old,sourceVersion:4,currentPath:target,compression:'none' as const,format,verifyCurrentFile:verify}
   const first=await prepareJsonlMigration(options),second=await prepareJsonlMigration(options)
   const [a,b]=await Promise.all([first.publish(),second.publish()]);expect(a).toBeDefined();expect(b).toBeDefined();expect(await readFile(old)).toEqual(original)
   const targetRows=(await readFile(target,'utf8')).trimEnd().split('\n').map(x=>JSON.parse(x));const restored=experimentalV5Catalog.createRestore(targetRows[0],{recovery:'strict',validation:'current'});for(const row of targetRows.slice(1))restored.decodeRow(row);const restoredArtifact=restored.finish();expect(restoredArtifact.events.map(e=>e.type)).toEqual(['session/title','plugin:synthetic']);expect(restoredArtifact.header.parentSession).toBe('synthetic-parent')
   await expect(ctx.sessionPersistence.open(id,'read')).rejects.toThrow();await expect(ctx.sessionPersistence.open(id,'write')).rejects.toThrow();expect(await readFile(old)).toEqual(original)
  } finally {await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})}
 })
 it('refuses changed source but an abort after preparation does not cancel publication',async()=>{
  const root=await mkdtemp(join(tmpdir(),'title-v5-fence-'));const old=join(root,'session.v4.jsonl'),target=join(root,'session.v5.jsonl')
  const header={type:'session',version:4,id:'synthetic',createdAt:1,isSeeded:false,delegationDepth:0};const bytes=JSON.stringify(header)+'\n'
  try {
   await writeFile(old,bytes);const base={sourcePath:old,sourceVersion:4,currentPath:target,compression:'none' as const,format,verifyCurrentFile:verify}
   const alreadyAborted=new AbortController();const fenced=await prepareJsonlMigration(base);alreadyAborted.abort();const publishIfActive=()=>{alreadyAborted.signal.throwIfAborted();return fenced.publish()};expect(publishIfActive).toThrow();await expect(stat(target)).rejects.toMatchObject({code:'ENOENT'})
   const stale=await prepareJsonlMigration(base);await writeFile(old,JSON.stringify({...header,createdAt:2})+'\n');await expect(stale.publish()).rejects.toThrow();await expect(stat(target)).rejects.toMatchObject({code:'ENOENT'})
   await writeFile(old,bytes);const abort=new AbortController();const pending=await prepareJsonlMigration({...base,signal:abort.signal});abort.abort();await expect(pending.publish()).resolves.toBeDefined();expect(await stat(target)).toBeDefined();expect(await readFile(old,'utf8')).toBe(bytes)
  } finally {await rm(root,{recursive:true,force:true})}
 })
 it('documents ignored incomplete tail and refuses seeded or gapped source before publishing',async()=>{
  const root=await mkdtemp(join(tmpdir(),'title-v5-gen-bad-'));const old=join(root,'session.v4.jsonl'),target=join(root,'session.v5.jsonl')
  const options={sourcePath:old,sourceVersion:4,currentPath:target,compression:'none' as const,format,verifyCurrentFile:verify}
  try {
   const header={type:'session',version:4,id:'synthetic',createdAt:1,isSeeded:false,delegationDepth:0}
   const truncated=JSON.stringify(header)+'\n{"type":';await writeFile(old,truncated)
   const observed=await prepareJsonlMigration(options);expect(observed.artifact.events).toEqual([]);expect(await readFile(old,'utf8')).toBe(truncated)
   // No publish: a strict preflight would need atomic binding to the generation read.
   await expect(stat(target)).rejects.toMatchObject({code:'ENOENT'})
   for(const bytes of [JSON.stringify({...header,isSeeded:true})+'\n',JSON.stringify(header)+'\n'+JSON.stringify({type:'session/title',seq:1,time:1,data:{title:'x',messageSeqs:[],source:{kind:'user'}}})+'\n']) {
    await writeFile(old,bytes);await expect(prepareJsonlMigration(options)).rejects.toThrow();await expect(stat(target)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(old,'utf8')).toBe(bytes)
   }
  } finally {await rm(root,{recursive:true,force:true})}
 })
})

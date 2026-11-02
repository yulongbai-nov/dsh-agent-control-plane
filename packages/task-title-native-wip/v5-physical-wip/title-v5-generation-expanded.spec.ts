/** Synthetic-only lower-level JSONL generation with experimental catalog and local verifier. */
import { describe,expect,it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { access,mkdir,mkdtemp,readFile,rm,stat,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareJsonlMigration } from '../src/generation.ts'
import { generationLogPath } from '../src/format.ts'
import { experimentalV5Catalog } from '../../../../synthetic-title-migration-wip/v5-codec.ts'
import { oneTurnLog } from '../../session-persistence/tests/contract.ts'
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
   const records=[...oneTurnLog(),{type:'session/title',seq:SessionSeq(6),time:7,data:{title:'Fallback',messageSeqs:[SessionSeq(1)],source:{kind:'fallback'}}},{type:'session/title',seq:SessionSeq(7),time:8,data:{title:'Provider',messageSeqs:[SessionSeq(1)],source:{kind:'provider',provider:'synthetic'}}},{type:'session/title',seq:SessionSeq(8),time:9,data:{title:'Pinned',messageSeqs:[],source:{kind:'user'}}},{type:'plugin:synthetic',seq:SessionSeq(9),time:10,data:{value:'opaque'},ignorable:true} as never];await write.append(records);await write.flush();await write.close()
   const old=generationLogPath(root,undefined,id,4,'none'), target=generationLogPath(root,undefined,id,5,'none'), original=await readFile(old)
   const options={sourcePath:old,sourceVersion:4,currentPath:target,compression:'none' as const,format,verifyCurrentFile:verify}
   const first=await prepareJsonlMigration(options),second=await prepareJsonlMigration(options)
   const [a,b]=await Promise.all([first.publish(),second.publish()]);expect(a).toBeDefined();expect(b).toBeDefined();expect(await readFile(old)).toEqual(original)
   const targetRows=(await readFile(target,'utf8')).trimEnd().split('\n').map(x=>JSON.parse(x));const restored=experimentalV5Catalog.createRestore(targetRows[0],{recovery:'strict',validation:'current'});for(const row of targetRows.slice(1))restored.decodeRow(row);const restoredArtifact=restored.finish();expect(restoredArtifact.events).toEqual(records);expect(restoredArtifact.header.parentSession).toBe('synthetic-parent')
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
 it('accepts a valid synthetic V4 seed in old catalog but refuses the experimental migration',async()=>{
  const root=await mkdtemp(join(tmpdir(),'title-v5-seeded-'));const old=join(root,'session.v4.jsonl'),target=join(root,'session.v5.jsonl')
  const header={type:'session',version:4,id:'synthetic-fork',parentSession:'synthetic-parent',createdAt:1,isSeeded:true,delegationDepth:0};const marker={type:'session/end-seed',seq:0,time:2,data:{inherited:true}};const bytes=[header,marker].map(x=>JSON.stringify(x)).join('\n')+'\n'
  try {
   const legacy=sessionFormatCatalog.createRestore(header,{recovery:'strict',validation:'current'});legacy.decodeRow(marker);expect(legacy.finish().inheritedEventCount).toBe(0)
   await writeFile(old,bytes);await expect(prepareJsonlMigration({sourcePath:old,sourceVersion:4,currentPath:target,compression:'none',format,verifyCurrentFile:verify})).rejects.toThrow();await expect(stat(target)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(old,'utf8')).toBe(bytes)
  } finally {await rm(root,{recursive:true,force:true})}
 })
 it('races two isolated publishers and survives controlled termination around publication',async()=>{
  const root=await mkdtemp(join(tmpdir(),'title-v5-child-'));const header={type:'session',version:4,id:'synthetic',createdAt:1,isSeeded:false,delegationDepth:0};const original=JSON.stringify(header)+'\n';const children:Array<{child:ReturnType<typeof spawn>,done:Promise<{code:number|null,signal:NodeJS.Signals|null}>}>=[]
  const launch=(mode:string,worker:string,location=root)=>{const child=spawn(process.execPath,[join(process.cwd(),'node_modules/vitest/vitest.mjs'),'run','packages/session/session-persistence-jsonl/tests/title-v5-generation-child.spec.ts','--pool=threads','--maxWorkers=1','--no-file-parallelism','--reporter=dot'],{cwd:process.cwd(),env:{PATH:'/usr/bin:/bin',TMPDIR:process.env.TMPDIR!,CI:'1',R9_SYNTHETIC_ROOT:location,R9_MODE:mode,R9_WORKER:worker},stdio:'ignore'});const done=new Promise<{code:number|null,signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject)});const record={child,done};children.push(record);return record}
  const wait=async(path:string,location=root)=>{for(let i=0;i<500;i++){try{await access(join(location,path));return}catch{await delay(20)}}throw Error('fixture barrier timeout')}
  const settle=async(p:Promise<unknown>)=>Promise.race([p,delay(5000).then(()=>{throw Error('child exit timeout')})])
  try {
   await writeFile(join(root,'session.v4.jsonl'),original)
   const a=launch('race','a'),b=launch('race','b');await Promise.all([wait('ready-a'),wait('ready-b')]);await writeFile(join(root,'release'),'go');expect(await settle(a.done)).toEqual({code:0,signal:null});expect(await settle(b.done)).toEqual({code:0,signal:null});expect(await readFile(join(root,'session.v4.jsonl'),'utf8')).toBe(original)
   for(const phase of ['before-source-check','after-publication']) {
    const location=join(root,phase);await mkdir(location);await writeFile(join(location,'session.v4.jsonl'),original)
    const c=launch(phase,'x',location);await wait('barrier-x',location);expect(c.child.kill('SIGKILL')).toBe(true);expect(await settle(c.done)).toEqual({code:null,signal:'SIGKILL'})
    expect(await readFile(join(location,'session.v4.jsonl'),'utf8')).toBe(original)
    if(phase==='before-source-check') await expect(stat(join(location,'session.v5.jsonl'))).rejects.toMatchObject({code:'ENOENT'})
    else {const target=await readFile(join(location,'session.v5.jsonl'),'utf8');const rows=target.trimEnd().split('\n').map(x=>JSON.parse(x));const restored=experimentalV5Catalog.createRestore(rows[0],{recovery:'strict',validation:'current'});for(const row of rows.slice(1))restored.decodeRow(row);expect(restored.finish()).toMatchObject({header:{version:5,id:'synthetic'},events:[]})}
   }
  } finally {
   for(const {child,done} of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await settle(done)}
   await rm(root,{recursive:true,force:true})
  }
 },30000)
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

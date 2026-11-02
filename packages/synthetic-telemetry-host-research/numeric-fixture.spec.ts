/** Test-only source adapter: actual pinned JSONL and token fold, no real data. */
import {describe,expect,it} from 'vitest'
import {Context} from '@deepseek-ai/cordis'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import {SessionId,SESSION_FORMAT_VERSION} from '@deepseek-ai/dsh-session'
import {oneTurnLog} from '../../../session/session-persistence/tests/contract.ts'
import {readFixtureProjection} from '../../../../synthetic-telemetry-host-wip/numeric-adapter.ts'
import {openSyntheticLedger} from '../../../../synthetic-telemetry-host-wip/ledger/index.mjs'
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const marker='SYNTHETIC_SENTINEL_NEVER_PERSIST_TO_LEDGER'
const key='a'.repeat(64),epoch='b'.repeat(64)
describe('bounded numeric synthetic JSONL adapter',()=>{
 it('folds one complete fixture turn, stores numbers only and fails closed on cuts/usage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'numeric-telemetry-'));const ctx=new Context();let ledger:any
  try{
   await mkdir(join(root,'db'),{mode:0o700});ledger=openSyntheticLedger(join(root,'db'));await ctx.plugin(Jsonl,{root:join(root,'jsonl'),compression:'none'})
   const id=SessionId('synthetic-session');const writer=await ctx.sessionPersistence.create({version:SESSION_FORMAT_VERSION,id,createdAt:1,isSeeded:false,delegationDepth:0})
   const events=structuredClone(oneTurnLog()) as any[];events[1].data.content[0].text=marker
   events[3].data.usage={inputTokens:10,outputTokens:7,cacheReadTokens:0,cacheWriteTokens:0}
   events[3].data.stream.splice(-1,0,{type:'chunk',time:4,chunk:{type:'usage',usage:{inputTokens:10,outputTokens:7,cacheReadTokens:0,cacheWriteTokens:0}}})
   await writer.append(events);await writer.flush();await writer.close()
   const observed=await readFixtureProjection(ctx.sessionPersistence,id,20);expect(observed).toEqual({status:'observed',asOfSeq:5,outputTokens:7,durable:'unknown'})
   expect(await readFixtureProjection(ctx.sessionPersistence,id,5)).toEqual({status:'unknown'})
   const unknownId=SessionId('synthetic-unknown');const unknownWriter=await ctx.sessionPersistence.create({version:SESSION_FORMAT_VERSION,id:unknownId,createdAt:1,isSeeded:false,delegationDepth:0});await unknownWriter.append(oneTurnLog());await unknownWriter.flush();await unknownWriter.close();expect(await readFixtureProjection(ctx.sessionPersistence,unknownId,20)).toEqual({status:'unknown'})
   const malformed={open:async()=>({read:async()=>({events:[{type:'turn/start',seq:1,time:1,data:{turn:1}}]}),close:async()=>{}})};expect(await readFixtureProjection(malformed,id,20)).toEqual({status:'unknown'})
   const invalid=structuredClone(events);invalid[3].data.usage.outputTokens=-1;invalid[3].data.stream.at(-2).chunk.usage.outputTokens=-1
   expect(await readFixtureProjection({open:async()=>({read:async()=>({events:invalid}),close:async()=>{}})},id,20)).toEqual({status:'unknown'})
   expect(await readFixtureProjection({open:async()=>({read:async()=>({events}),close:async()=>{throw Error('fixture close failed')}})},id,20)).toEqual({status:'unknown'})
   if(observed.status!=='observed')throw Error('missing fixture projection');ledger.ingest({sessionKey:key,sourceEpoch:epoch,asOfSeq:observed.asOfSeq,outputTokens:observed.outputTokens});ledger.close();ledger=undefined
   for(const name of await readdir(join(root,'db'))){const bytes=await readFile(join(root,'db',name));expect(bytes.includes(Buffer.from(marker))).toBe(false)}
   ledger=openSyntheticLedger(join(root,'db'));expect(ledger.get({sessionKey:key,sourceEpoch:epoch})).toEqual({status:'observed',asOfSeq:5,outputTokens:7,durable:'unknown'})
  }finally{ledger?.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})}
 })
})

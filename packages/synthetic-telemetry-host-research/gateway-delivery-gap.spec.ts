/** Synthetic-only Gateway authorization characterization, not a production endpoint. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import type { RemoteAccessBinding } from '@deepseek-ai/dsh-api-remote-access'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { peerFor, ownerPeer } from './peer.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
 interface PrincipalMap { 'synthetic-telemetry': {kind:'synthetic-telemetry',subject:string} }
 interface TypertResourceMap { 'synthetic-workspace': import('@deepseek-ai/dsh-typert-protocol').TypertResource<string>; 'synthetic-session': import('@deepseek-ai/dsh-typert-protocol').TypertResource<string>; 'synthetic-channel': import('@deepseek-ai/dsh-typert-protocol').TypertResource<string> }
}
type Req = {workspaceId:string, sessionId:string, channel:string}
const fixture = {afterCheck:undefined as undefined | (()=>void),epoch:0, opened:0, closed:0, gate:Promise.withResolvers<void>(), entries:new Map([['session-a','workspace-a']])}
class TelemetryFixture extends TypertRemoteService {
 constructor(ctx:Context) {super(ctx,'syntheticTelemetry')}
 @Remote({resources:{'synthetic-workspace':(r:Req)=>r.workspaceId,'synthetic-session':(r:Req)=>r.sessionId,'synthetic-channel':(r:Req)=>r.channel}})
 async sample(request:Req):Promise<number> {
   const inv=this.ctx.invocation
   if (!inv || inv.peer.principal.kind !== 'synthetic-telemetry' || inv.signal.aborted || inv.peer.signal.aborted) throw Error('DENIED')
   if (fixture.entries.get(request.sessionId)!==request.workspaceId) throw Error('DENIED')
   const resources=[{kind:'synthetic-workspace',id:request.workspaceId},{kind:'synthetic-session',id:request.sessionId},{kind:'synthetic-channel',id:request.channel}] as const
   const epoch=fixture.epoch
   const allowed=()=>fixture.epoch===epoch&&!inv.signal.aborted&&!inv.peer.signal.aborted&&resources.every(r=>this.ctx.remoteAccess.allows(r))
   if (!allowed()) throw Error('DENIED')
   fixture.opened++
   try {await fixture.gate.promise; if (!allowed()) throw Error('DENIED');fixture.afterCheck?.();return 1} finally {fixture.closed++}
 }
}

describe('synthetic telemetry Gateway scope and revision fixture',()=>{
 it('requires all explicit scopes and fences revoke/regrant while a synthetic read is pending',async()=>{
  const ctx=new Context(); fixture.epoch=0;fixture.opened=0;fixture.closed=0;fixture.gate=Promise.withResolvers<void>()
  try {
   await ctx.plugin(TypertRegistry);await ctx.plugin(RemoteAccessService);await ctx.plugin(TypertGatewayService)
   for (const [kind,field] of [['synthetic-workspace','workspaceId'],['synthetic-session','sessionId'],['synthetic-channel','channel']] as const) ctx.typert.resources.register(kind,{field})
   await ctx.plugin(TelemetryFixture)
   let held:RemoteAccessBinding[]=[]
   ctx.remoteAccess.registerPolicy('synthetic-telemetry',{bindings:(p)=>p.subject==='alice'?held:[]})
   const set=(workspace='workspace-a', session='session-a', channel='local-report')=>{fixture.epoch++;held=[{role:{name:'w',resource:'synthetic-workspace',actions:['syntheticTelemetry/sample']},resource:{kind:'synthetic-workspace',id:workspace}},{role:{name:'s',resource:'synthetic-session',actions:['syntheticTelemetry/sample']},resource:{kind:'synthetic-session',id:session}},{role:{name:'c',resource:'synthetic-channel',actions:['syntheticTelemetry/sample']},resource:{kind:'synthetic-channel',id:channel}}];ctx.remoteAccess.invalidate()}
   const req={workspaceId:'workspace-a',sessionId:'session-a',channel:'local-report'}
   const call=(subject='alice',request=req)=>ctx.typertGateway.invoke({peer:peerFor(ctx,{kind:'synthetic-telemetry',subject}),namespace:'syntheticTelemetry',method:'sample',args:{request}})
   await expect(call()).rejects.toMatchObject({code:'remote-access/denied'});expect(fixture.opened).toBe(0)
   await expect((ctx.get('syntheticTelemetry') as TelemetryFixture).sample(req)).rejects.toThrow('DENIED')
   set(); await expect(call('bob')).rejects.toMatchObject({code:'remote-access/denied'})
   await expect(call('alice',{...req,workspaceId:'workspace-b'})).rejects.toMatchObject({code:'remote-access/denied'})
   await expect(call('alice',{...req,channel:'model'})).rejects.toMatchObject({code:'remote-access/denied'})
   await expect(call('alice',{...req,sessionId:'session-b'})).rejects.toMatchObject({code:'remote-access/denied'})
   set('workspace-b');await expect(call('alice',{...req,workspaceId:'workspace-b'})).rejects.toThrow('DENIED');set()
   await expect(ctx.typertGateway.invoke({peer:ownerPeer(ctx),namespace:'syntheticTelemetry',method:'sample',args:{request:req}})).rejects.toThrow('DENIED')
   const pending=call();await new Promise<void>(r=>setTimeout(r,0));expect(fixture.opened).toBe(1)
   fixture.epoch++;held=[];ctx.remoteAccess.invalidate();set();fixture.gate.resolve();await expect(pending).rejects.toThrow('DENIED');expect(fixture.closed).toBe(1)
   fixture.gate=Promise.withResolvers<void>();const permitted=call();await new Promise<void>(r=>setTimeout(r,0));fixture.gate.resolve();expect(await permitted).toBe(1);expect(fixture.closed).toBe(2)
   // Controlled revocation queued after endpoint's final check, before Gateway promise settles.
   fixture.afterCheck=()=>queueMicrotask(()=>{fixture.epoch++;held=[];ctx.remoteAccess.invalidate()})
   const late=await call();expect(late).toBe(1);expect(held).toEqual([])
   await expect(call()).rejects.toMatchObject({code:'remote-access/denied'});expect(fixture.closed).toBe(3)
  } finally { await ctx.fiber.dispose() }
 })
})

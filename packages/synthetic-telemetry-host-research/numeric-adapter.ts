/** Synthetic fixture only; not authenticated, complete, durable, or installable. */
import { deriveTurnTokenUsage } from '../packages/llm/token-meter/src/turn-usage.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
type Handle={read:(offset:number,length:number)=>Promise<{events:readonly SessionEvent[]}>,close:()=>Promise<void>}
type Source={open:(id:any,mode:'read')=>Promise<Handle>}
type Result={status:'unknown'}|{status:'observed',asOfSeq:number,outputTokens:number,durable:'unknown'}
const unknown=():Result=>({status:'unknown'})
/** Reads at most max+1 events, returns only numeric data, fails closed. */
export async function readFixtureProjection(source:Source,id:any,max:number):Promise<Result>{
 if(!Number.isSafeInteger(max)||max<1||max>100)return unknown()
 let handle:Handle|undefined;let result:Result=unknown()
 try {
  handle=await source.open(id,'read');const {events}=await handle.read(0,max+1)
  if(events.length===0||events.length>max) return unknown()
  let active:SessionEvent[]|undefined,total=0,turns=0
  for(const [index,event] of events.entries()){
   if(event.seq!==index) return unknown()
   if(event.type==='turn/start'){if(active) return unknown();active=[]}
   if(!active) return unknown()
   active.push(event)
   if(event.type==='turn/end'){
    const usage=deriveTurnTokenUsage(active);if(!usage)return unknown()
    total+=usage.outputTokens;if(!Number.isSafeInteger(total))return unknown();turns++;active=undefined
   }
  }
  if(active||turns===0)return unknown()
  result={status:'observed',asOfSeq:events.length-1,outputTokens:total,durable:'unknown'}
 } catch {result=unknown()}
 finally {if(handle)try{await handle.close()}catch{result=unknown()}}
 return result
}

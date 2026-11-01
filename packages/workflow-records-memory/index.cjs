'use strict';
const {types:{isProxy}}=require('node:util');
const codeError=(code)=>Object.assign(new Error(code),{code});
const invalid=()=>{throw codeError('INVALID_INPUT');};
const record=(input,allowed,required=allowed)=>{
  if(!input || typeof input!=='object' || isProxy(input) || Array.isArray(input)) invalid();
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype && proto!==null) invalid();
  const values=Object.create(null);
  for(const key of Reflect.ownKeys(input)){
    if(typeof key!=='string' || !allowed.includes(key)) invalid();
    const descriptor=Object.getOwnPropertyDescriptor(input,key);
    if(!descriptor || !Object.hasOwn(descriptor,'value') || !descriptor.enumerable) invalid();
    values[key]=descriptor.value;
  }
  if(required.some((key)=>!Object.hasOwn(values,key))) invalid();
  return values;
};
const keyOf=(input)=>{
  const value=record(input,['sessionId','runId']);
  if(typeof value.sessionId!=='string' || !value.sessionId || value.sessionId.length>256 ||
     typeof value.runId!=='string' || !value.runId || value.runId.length>256) invalid();
  return value;
};
const eventOf=(input)=>{
  const value=record(input,['type','eventSeq','outcome'],['type','eventSeq']);
  if(!Number.isSafeInteger(value.eventSeq)||value.eventSeq<0||Object.is(value.eventSeq,-0)) invalid();
  if(value.type==='run-start' && !Object.hasOwn(value,'outcome')) return value;
  if(value.type==='run-end' && ['completed','error','cancelled'].includes(value.outcome)) return value;
  invalid();
};
const configOf=(input)=>{
  if(input===undefined) return {maxRuns:1024,maxListeners:32};
  const value=record(input,['maxRuns','maxListeners'],[]);
  const maxRuns=value.maxRuns===undefined?1024:value.maxRuns;
  const maxListeners=value.maxListeners===undefined?32:value.maxListeners;
  if(!Number.isSafeInteger(maxRuns)||maxRuns<1||maxRuns>1024||!Number.isSafeInteger(maxListeners)||maxListeners<1||maxListeners>32) invalid();
  return {maxRuns,maxListeners};
};
function createMemoryRecords(options){
  const {maxRuns,maxListeners}=configOf(options);
  const runs=new Map(),listeners=new Set();
  let count=0,notifying=false;
  const read=(rawKey)=>{
    const key=keyOf(rawKey);
    return runs.get(key.sessionId)?.get(key.runId)?.snapshot || Object.freeze({state:'unknown'});
  };
  const observe=(rawKey,rawEvent)=>{
    if(notifying) throw codeError('REENTRANT');
    const key=keyOf(rawKey),event=eventOf(rawEvent);
    let session=runs.get(key.sessionId);
    const prior=session?.get(key.runId);
    if(prior){
      for(const seen of [prior.start,prior.end]) if(seen && event.eventSeq===seen.eventSeq){
        if(event.type===seen.type && event.outcome===seen.outcome) return prior.snapshot;
        throw codeError('CONFLICT');
      }
      if(event.eventSeq<prior.event.eventSeq) throw codeError('OUT_OF_ORDER');
      if(prior.event.type==='run-end' || event.type==='run-start') throw codeError('CONFLICT');
    } else if(count>=maxRuns) throw codeError('LIMIT');
    const hasStart=prior?.snapshot.hasStart===true || event.type==='run-start';
    const lifecycle=hasStart && event.type==='run-end' ? (event.outcome==='error'?'failed':event.outcome) : 'unknown';
    const snapshot=Object.freeze({version:1,state:hasStart?'observed':'incomplete',revision:(prior?.snapshot.revision || 0)+1,sessionId:key.sessionId,runId:key.runId,sourceStatus:'unverified',hasStart,startEventSeq:event.type==='run-start'?event.eventSeq:prior?.snapshot.startEventSeq ?? null,lastEventSeq:event.eventSeq,observedOutcome:event.type==='run-end'?event.outcome:null,lifecycle});
    if(!session){session=new Map();runs.set(key.sessionId,session);}
    session.set(key.runId,{event,snapshot,start:event.type==='run-start'?event:prior?.start,end:event.type==='run-end'?event:prior?.end});
    if(!prior) count++;
    const notice=Object.freeze({sessionId:key.sessionId,runId:key.runId,revision:snapshot.revision});
    notifying=true;
    try {
      for(const registration of [...listeners]) {
        if(!listeners.has(registration) || registration.key.sessionId!==key.sessionId || registration.key.runId!==key.runId) continue;
        try {Promise.resolve(registration.listener(notice)).catch(()=>{});} catch {}
      }
    } finally {notifying=false;}
    return snapshot;
  };
  const subscribe=(rawKey,listener)=>{
    const key=keyOf(rawKey);
    if(typeof listener!=='function'||isProxy(listener)) invalid();
    if(listeners.size>=maxListeners) throw codeError('LIMIT');
    const registration={key,listener};
    listeners.add(registration);
    let active=true;
    return ()=>{if(active){active=false;listeners.delete(registration);}};
  };
  return Object.freeze({read,observe,subscribe});
}
module.exports={createMemoryRecords};

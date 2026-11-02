import { types } from 'node:util';

// In-memory fixture model only; no object in this module authenticates a real Host.
const id=value=>typeof value==='string' && value.length<=64 && /^fixture-[a-z0-9-]+$/.test(value);
const fail=()=>{throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});};
function capture(value,names) {
  if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)) fail();
  const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null) fail();
  const keys=Reflect.ownKeys(value);if(keys.length!==names.length||keys.some(k=>typeof k!=='string'||!names.includes(k))) fail();
  const out=Object.create(null);
  for(const name of names){const d=Object.getOwnPropertyDescriptor(value,name);if(!d||!Object.hasOwn(d,'value'))fail();out[name]=d.value;}
  return out;
}
function plan(value) {
  const p=capture(value,['workspaceId','workflowId','expectedRunIds']);
  if(!id(p.workspaceId)||!id(p.workflowId)||types.isProxy(p.expectedRunIds)||!Array.isArray(p.expectedRunIds)||p.expectedRunIds.length<1||p.expectedRunIds.length>32)fail();
  const keys=Reflect.ownKeys(p.expectedRunIds);if(keys.length!==p.expectedRunIds.length+1||keys.some(k=>typeof k!=='string'))fail();
  const expected=[];
  for(let i=0;i<p.expectedRunIds.length;i++){const d=Object.getOwnPropertyDescriptor(p.expectedRunIds,String(i));if(!d||!Object.hasOwn(d,'value')||!id(d.value)||expected.includes(d.value))fail();expected.push(d.value);}
  return Object.freeze({workspaceId:p.workspaceId,workflowId:p.workflowId,expected:Object.freeze(expected)});
}
function receipt(value) {
  const r=capture(value,['workspaceId','workflowId','sessionId','generationId','runId','attemptId','startSeq','endSeq','outcome']);
  if(!['workspaceId','workflowId','sessionId','generationId','runId','attemptId'].every(k=>id(r[k])) ||
     !Number.isSafeInteger(r.startSeq)||r.startSeq<0||Object.is(r.startSeq,-0)||
     !Number.isSafeInteger(r.endSeq)||r.endSeq<=r.startSeq||Object.is(r.endSeq,-0)||
     !['completed','error','cancelled'].includes(r.outcome))fail();
  return Object.freeze(r);
}
const unknown=reason=>Object.freeze({fixtureStatus:'UNKNOWN',reason,productionStatus:'UNKNOWN',durability:'UNKNOWN',tokenAttribution:'UNKNOWN'});
const token=()=>Object.freeze(Object.create(null));

/**
 * Create one isolated synthetic fixture. The creator owns the issuer; a fake
 * receipt is never evidence of real execution, durable coverage or authority.
 */
export function createSyntheticAccumulator(input) {
  const p=plan(input),issued=new WeakMap(),records=new Map(),attempts=new Map(),eventOwners=new Map();
  const seal=token(),observed=new WeakSet();let conflicted=false,sealed=false,issuedCount=0,observedCount=0,overflow=false;
  const issuer=Object.freeze({
    issue(inputReceipt){
      if(sealed)throw Object.assign(new Error('FIXTURE_SEALED'),{code:'FIXTURE_SEALED'});
      const r=receipt(inputReceipt);
      if(issuedCount>=64){overflow=true;throw Object.assign(new Error('LIMIT'),{code:'LIMIT'});}
      const t=token();issued.set(t,r);issuedCount++;return t;
    },
    seal(){sealed=true;return seal;},
  });
  const reader=Object.freeze({
    observe(t) {
      if(!t||typeof t!=='object'||!issued.has(t))return unknown('UNVERIFIED_FIXTURE_RECEIPT');
      if(conflicted)return unknown('CONFLICT');
      if(!observed.has(t)){observed.add(t);observedCount++;}
      const r=issued.get(t);
      if(r.workspaceId!==p.workspaceId||r.workflowId!==p.workflowId||!p.expected.includes(r.runId)) {conflicted=true;return unknown('SCOPE_OR_RUN_CONFLICT');}
      const existing=records.get(r.runId);
      if(existing){
        if(Object.keys(r).every(k=>existing[k]===r[k]))return Object.freeze({fixtureStatus:'DUPLICATE',productionStatus:'UNKNOWN'});
        conflicted=true;return unknown('CONFLICT');
      }
      const prevAttempt=attempts.get(r.attemptId);
      if(prevAttempt!==undefined&&prevAttempt!==r.runId){conflicted=true;return unknown('ATTEMPT_CONFLICT');}
      const start=JSON.stringify([r.workspaceId,r.sessionId,r.generationId,r.startSeq]);
      const end=JSON.stringify([r.workspaceId,r.sessionId,r.generationId,r.endSeq]);
      if(eventOwners.has(start)||eventOwners.has(end)){conflicted=true;return unknown('EVENT_CONFLICT');}
      records.set(r.runId,r);attempts.set(r.attemptId,r.runId);eventOwners.set(start,r.runId);eventOwners.set(end,r.runId);
      return Object.freeze({fixtureStatus:'RECORDED',productionStatus:'UNKNOWN'});
    },
    report(sealToken) {
      if(sealToken!==seal)return unknown('UNSEALED_FIXTURE');
      if(conflicted||overflow)return unknown('CONFLICT_OR_OVERFLOW');
      if(observedCount!==issuedCount||records.size!==p.expected.length)return unknown('INCOMPLETE_FIXTURE');
      let completed=0,error=0,cancelled=0;
      for(const r of records.values()) {if(r.outcome==='completed')completed++;else if(r.outcome==='error')error++;else cancelled++;}
      return Object.freeze({fixtureStatus:'COMPLETE_IN_FIXTURE',fixtureCounts:Object.freeze({runs:records.size,completed,error,cancelled}),productionStatus:'UNKNOWN',durability:'UNKNOWN',tokenAttribution:'UNKNOWN'});
    },
  });
  return Object.freeze({issuer,reader});
}

import { types } from 'node:util';

// Synthetic test-only capability model. The caller holding the issuer can issue
// any fixture grant; this is not a production authorization mechanism.
const pairs=Object.freeze({
  collect:Object.freeze(['collection']),
  report:Object.freeze(['local','model','remote']),
  export:Object.freeze(['export']),
  purge:Object.freeze(['purge']),
});
const digest=value=>typeof value==='string' && value.length===64 && /^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});};
function fields(value,names) {
  if (!value || typeof value!=='object' || types.isProxy(value) || Array.isArray(value)) fail();
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype && proto!==null) fail();
  const keys=Reflect.ownKeys(value);
  if(keys.length!==names.length || keys.some(key=>typeof key!=='string'||!names.includes(key))) fail();
  const result=Object.create(null);
  for(const name of names) {
    const descriptor=Object.getOwnPropertyDescriptor(value,name);
    if(!descriptor||!Object.hasOwn(descriptor,'value')) fail();
    result[name]=descriptor.value;
  }
  return result;
}
function scope(value) {
  const v=fields(value,['workspaceKey','sessionKey','operation','channel']);
  if(!digest(v.workspaceKey)||!digest(v.sessionKey)||typeof v.operation!=='string'||!Object.hasOwn(pairs,v.operation)||
     typeof v.channel!=='string'||!pairs[v.operation].includes(v.channel)) fail();
  return v;
}
const decision=(syntheticResult,reason)=>Object.freeze({syntheticResult,reason,productionAuthorization:'UNKNOWN'});
const token=()=>Object.freeze(Object.create(null));

/** Fixture issuer and evaluator; only a trusted test harness may hold the issuer. */
export function createSyntheticAuthorization() {
  const callers=new WeakMap(), grants=new WeakMap(), revoked=new WeakSet();
  return Object.freeze({
    issueCaller(input) {
      const { subjectKey }=fields(input,['subjectKey']); if(!digest(subjectKey)) fail();
      const caller=token(); callers.set(caller,subjectKey); return caller;
    },
    issueGrant(caller,input) {
      if(!caller || typeof caller!=='object' || !callers.has(caller)) throw Object.assign(new Error('UNVERIFIED_CALLER'),{code:'UNVERIFIED_CALLER'});
      const s=scope(input),grant=token();
      grants.set(grant,Object.freeze({caller,workspaceKey:s.workspaceKey,sessionKey:s.sessionKey,operation:s.operation,channel:s.channel}));
      return grant;
    },
    revoke(grant) {
      if(!grant || typeof grant!=='object' || !grants.has(grant)) throw Object.assign(new Error('UNVERIFIED_GRANT'),{code:'UNVERIFIED_GRANT'});
      revoked.add(grant);
    },
    authorize(input) {
      let request;
      try { request=fields(input,['caller','grant','workspaceKey','sessionKey','operation','channel']); }
      catch { return decision('DENY','INVALID_REQUEST'); }
      let requested;
      try { requested=scope({workspaceKey:request.workspaceKey,sessionKey:request.sessionKey,operation:request.operation,channel:request.channel}); }
      catch { return decision('DENY','INVALID_REQUEST'); }
      if(!request.caller || typeof request.caller!=='object' || !callers.has(request.caller)) return decision('DENY','UNVERIFIED_CALLER');
      if(!request.grant || typeof request.grant!=='object' || !grants.has(request.grant)) return decision('DENY','UNVERIFIED_GRANT');
      if(revoked.has(request.grant)) return decision('DENY','REVOKED');
      const g=grants.get(request.grant);
      if(g.caller!==request.caller) return decision('DENY','CALLER_MISMATCH');
      if(g.workspaceKey!==requested.workspaceKey||g.sessionKey!==requested.sessionKey) return decision('DENY','SCOPE_MISMATCH');
      if(g.operation!==requested.operation||g.channel!==requested.channel) return decision('DENY','GRANT_MISMATCH');
      return decision('ALLOW','SYNTHETIC_GRANT');
    },
  });
}

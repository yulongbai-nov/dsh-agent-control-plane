import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticAuthorization } from '../synthetic-authorization.mjs';
const identity=ch=>ch.repeat(64),workspaceKey=identity('a'),sessionKey=identity('b'),subjectKey=identity('c');
const scope=(operation='report',channel='local')=>({workspaceKey,sessionKey,operation,channel});
const setup=(operation='report',channel='local')=>{const issuer=createSyntheticAuthorization(),caller=issuer.issueCaller({subjectKey}),grant=issuer.issueGrant(caller,scope(operation,channel));return {issuer,caller,grant};};
const request=({caller,grant},overrides={})=>({caller,grant,...scope(),...overrides});

test('default deny and synthetic allow never claim production authorization',()=>{
 const {issuer,caller,grant}=setup();
 assert.deepEqual(issuer.authorize(request({caller,grant})),{syntheticResult:'ALLOW',reason:'SYNTHETIC_GRANT',productionAuthorization:'UNKNOWN'});
 assert.equal(issuer.authorize(request({caller,grant:{}})).reason,'UNVERIFIED_GRANT');
 assert.equal(issuer.authorize(request({caller:{subjectKey},grant})).reason,'UNVERIFIED_CALLER');
 assert.equal(issuer.authorize({}).syntheticResult,'DENY');
});

test('workspace, session and caller boundaries are exact',()=>{
 const {issuer,caller,grant}=setup(), other=issuer.issueCaller({subjectKey});
 assert.equal(issuer.authorize(request({caller,grant},{workspaceKey:identity('d')})).reason,'SCOPE_MISMATCH');
 assert.equal(issuer.authorize(request({caller,grant},{sessionKey:identity('d')})).reason,'SCOPE_MISMATCH');
 assert.equal(issuer.authorize(request({caller:other,grant})).reason,'CALLER_MISMATCH');
 const otherIssuer=createSyntheticAuthorization(); assert.equal(otherIssuer.authorize(request({caller,grant})).reason,'UNVERIFIED_CALLER');
});

test('local, model, remote, export, purge and collection are separate capabilities',()=>{
 const {issuer,caller,grant}=setup();
 for(const channel of ['model','remote']) assert.equal(issuer.authorize(request({caller,grant},{channel})).reason,'GRANT_MISMATCH');
 for(const [operation,channel] of [['export','export'],['purge','purge'],['collect','collection']])
  assert.equal(issuer.authorize(request({caller,grant},{operation,channel})).reason,'GRANT_MISMATCH');
 assert.equal(issuer.authorize(request({caller,grant},{operation:'collect',channel:'local'})).reason,'INVALID_REQUEST');
});

test('revocation denies future use and decisions and capability tokens are immutable',()=>{
 const {issuer,caller,grant}=setup(); const before=issuer.authorize(request({caller,grant}));
 assert.ok(Object.isFrozen(before));assert.ok(Object.isFrozen(caller));assert.ok(Object.isFrozen(grant));
 assert.equal(Reflect.set(before,'syntheticResult','ALLOW_AGAIN'),false);assert.equal(Reflect.set(grant,'workspaceKey',identity('d')),false);
 issuer.revoke(grant); assert.deepEqual(issuer.authorize(request({caller,grant})),{syntheticResult:'DENY',reason:'REVOKED',productionAuthorization:'UNKNOWN'});
 assert.equal(before.syntheticResult,'ALLOW');
});

test('malformed or forged input denies without invoking getters or leaking fixture data',()=>{
 const {issuer,caller,grant}=setup();let called=false;
 const bad=request({caller,grant});Object.defineProperty(bad,'workspaceKey',{get(){called=true;return workspaceKey;}});
 assert.equal(issuer.authorize(bad).reason,'INVALID_REQUEST');assert.equal(called,false);
 const proxy=Proxy.revocable(request({caller,grant}),{});proxy.revoke();assert.equal(issuer.authorize(proxy.proxy).syntheticResult,'DENY');
 const forged={...grant};assert.equal(issuer.authorize(request({caller,grant:forged})).reason,'UNVERIFIED_GRANT');
 const res=issuer.authorize(request({caller,grant},{workspaceKey:identity('d')})); assert.equal(JSON.stringify(res).includes(workspaceKey),false);
});

test('each supported operation and disclosure channel requires its own fixture grant',()=>{
 for(const [operation,channel] of [['collect','collection'],['report','local'],['report','model'],['report','remote'],['export','export'],['purge','purge']]) {
  const {issuer,caller,grant}=setup(operation,channel);
  assert.equal(issuer.authorize(request({caller,grant},{operation,channel})).syntheticResult,'ALLOW',operation+':'+channel);
 }
});

test('proxy wrappers and cloned tokens cannot forge issuer-held capability identity',()=>{
 const {issuer,caller,grant}=setup();
 assert.equal(issuer.authorize(request({caller:new Proxy(caller,{}),grant})).reason,'UNVERIFIED_CALLER');
 assert.equal(issuer.authorize(request({caller,grant:new Proxy(grant,{})})).reason,'UNVERIFIED_GRANT');
 assert.equal(issuer.authorize(request({caller,grant:structuredClone(grant)})).reason,'UNVERIFIED_GRANT');
});

test('oversized fixture digests are rejected without being echoed',()=>{
 const {issuer,caller,grant}=setup(), huge='a'.repeat(1000000);
 assert.throws(()=>issuer.issueCaller({subjectKey:huge}),e=>e.code==='INVALID_INPUT'&&e.message==='INVALID_INPUT');
 const result=issuer.authorize(request({caller,grant},{workspaceKey:huge}));
 assert.deepEqual(result,{syntheticResult:'DENY',reason:'INVALID_REQUEST',productionAuthorization:'UNKNOWN'});
 assert.equal(JSON.stringify(result).includes(huge),false);
});

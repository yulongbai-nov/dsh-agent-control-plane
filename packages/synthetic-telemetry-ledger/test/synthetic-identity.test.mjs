import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSyntheticIdentity } from '../synthetic-identity.mjs';
const secret='01'.repeat(32), otherSecret='02'.repeat(32);
const fixture=()=>({workspaceId:'test-workspace',sessionId:'test-session',sourceId:'synthetic-source',generationId:'generation-1'});
const code=expected=>e=>e.code===expected && e.message===expected;

test('synthetic identities are deterministic, opaque and domain separated',()=>{
 const a=deriveSyntheticIdentity(secret,fixture()),b=deriveSyntheticIdentity(secret,fixture());
 assert.deepEqual(a,b); assert.match(a.sessionKey,/^[a-f0-9]{64}$/); assert.match(a.sourceEpoch,/^[a-f0-9]{64}$/);
 assert.notEqual(a.sessionKey,a.sourceEpoch); assert.equal(JSON.stringify(a).includes('test-session'),false);
 assert.notDeepEqual(a,deriveSyntheticIdentity(otherSecret,fixture()));
});

test('scope and generation changes cannot collide by concatenation',()=>{
 const a=deriveSyntheticIdentity(secret,{...fixture(),workspaceId:'ab',sessionId:'c'});
 const b=deriveSyntheticIdentity(secret,{...fixture(),workspaceId:'a',sessionId:'bc'});
 assert.notEqual(a.sessionKey,b.sessionKey); assert.notEqual(a.sourceEpoch,b.sourceEpoch);
 const f=fixture(), initial=deriveSyntheticIdentity(secret,f);
 for(const field of ['workspaceId','sessionId','sourceId','generationId']) {
  const changed=deriveSyntheticIdentity(secret,{...f,[field]:f[field]+'-other'});
  assert.notEqual(initial.sourceEpoch,changed.sourceEpoch,field);
  if(field==='workspaceId'||field==='sessionId') assert.notEqual(initial.sessionKey,changed.sessionKey,field);
  else assert.equal(initial.sessionKey,changed.sessionKey,field);
 }
});

test('rejects malformed key and inputs without echoing synthetic values',()=>{
 for(const value of ['', 'a'.repeat(63), 'A'.repeat(64), Buffer.alloc(32), null]) assert.throws(()=>deriveSyntheticIdentity(value,fixture()),code('INVALID_INPUT'));
 for(const value of ['', '\ud800', '汉'.repeat(86), null, 3]) assert.throws(()=>deriveSyntheticIdentity(secret,{...fixture(),sessionId:value}),code('INVALID_INPUT'));
 assert.throws(()=>deriveSyntheticIdentity(secret,{...fixture(),text:'unapproved'}),code('INVALID_INPUT'));
});

test('rejects getters, inheritance, symbols and revoked proxies without invoking accessors',()=>{
 let called=false;const v=fixture();Object.defineProperty(v,'sessionId',{get(){called=true;return 'bad';},enumerable:true});
 assert.throws(()=>deriveSyntheticIdentity(secret,v),code('INVALID_INPUT'));assert.equal(called,false);
 assert.throws(()=>deriveSyntheticIdentity(secret,Object.create(fixture())),code('INVALID_INPUT'));
 const extra=fixture();extra[Symbol('x')]=1;assert.throws(()=>deriveSyntheticIdentity(secret,extra),code('INVALID_INPUT'));
 const proxy=Proxy.revocable(fixture(),{});proxy.revoke();assert.throws(()=>deriveSyntheticIdentity(secret,proxy.proxy),code('INVALID_INPUT'));
});

test('matches independently calculated HMAC-SHA-256 length-framed fixture',()=>{
 assert.deepEqual(deriveSyntheticIdentity(secret,fixture()),{
  sessionKey:'31962001129f04e111be16f50627a7e28181844bb2cca2302715371ba91cc415',
  sourceEpoch:'54c2ff3276051e93e857dcbed173d2470ab9f66c28ddc1990de1e98ec4832a84',
 });
});

test('derived session identity preserves tombstone across generation changes',async()=>{
 const { mkdtempSync,chmodSync,readFileSync }=await import('node:fs');
 const { tmpdir }=await import('node:os'); const { join,resolve }=await import('node:path');
 const { openSyntheticLedger }=await import('../index.mjs');
 const directory=mkdtempSync(join(resolve(tmpdir()),'identity-ledger-'));chmodSync(directory,0o700);
 const db=openSyntheticLedger(directory), first=deriveSyntheticIdentity(secret,fixture()), next=deriveSyntheticIdentity(secret,{...fixture(),generationId:'generation-2'});
 try {
  db.ingest({...first,asOfSeq:1,outputTokens:2});db.clear(first);
  assert.throws(()=>db.ingest({...next,asOfSeq:2,outputTokens:3}),code('TOMBSTONED'));
 } finally {db.close();}
 assert.equal(readFileSync(join(directory,'ledger.sqlite')).includes(Buffer.from('test-session')),false);
});

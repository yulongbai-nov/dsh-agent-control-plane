import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticAccumulator } from '../index.mjs';
const plan=()=>({workspaceId:'fixture-workspace',workflowId:'fixture-workflow',expectedRunIds:['fixture-run-a','fixture-run-b']});
const rec=(runId='fixture-run-a',overrides={})=>({workspaceId:'fixture-workspace',workflowId:'fixture-workflow',sessionId:'fixture-session',generationId:'fixture-generation',runId,attemptId:runId==='fixture-run-a'?'fixture-attempt-a':'fixture-attempt-b',startSeq:runId==='fixture-run-a'?1:3,endSeq:runId==='fixture-run-a'?2:4,outcome:'completed',...overrides});
const errorCode=expected=>e=>e.code===expected&&e.message===expected;

test('only sealed fully observed fixture receipts yield fixture-only counts',()=>{
 const {issuer,reader}=createSyntheticAccumulator(plan());const a=issuer.issue(rec()), b=issuer.issue(rec('fixture-run-b',{outcome:'error'}));
 assert.equal(reader.report({}).reason,'UNSEALED_FIXTURE');assert.equal(reader.observe(a).fixtureStatus,'RECORDED');
 const seal=issuer.seal();assert.equal(reader.report(seal).reason,'INCOMPLETE_FIXTURE');assert.equal(reader.observe(b).fixtureStatus,'RECORDED');
 const result=reader.report(seal);assert.deepEqual(result,{fixtureStatus:'COMPLETE_IN_FIXTURE',fixtureCounts:{runs:2,completed:1,error:1,cancelled:0},productionStatus:'UNKNOWN',durability:'UNKNOWN',tokenAttribution:'UNKNOWN'});
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.fixtureCounts));assert.equal(JSON.stringify(result).includes('fixture-session'),false);
 assert.throws(()=>issuer.issue(rec()),errorCode('FIXTURE_SEALED'));
});

test('forged, cloned and cross-issuer receipts cannot create counted facts',()=>{
 const one=createSyntheticAccumulator(plan()),two=createSyntheticAccumulator(plan()),t=one.issuer.issue(rec());
 assert.equal(two.reader.observe(t).reason,'UNVERIFIED_FIXTURE_RECEIPT');
 assert.equal(one.reader.observe({...t}).reason,'UNVERIFIED_FIXTURE_RECEIPT');
 assert.equal(one.reader.observe(new Proxy(t,{})).reason,'UNVERIFIED_FIXTURE_RECEIPT');
 assert.equal(one.reader.report(one.issuer.seal()).reason,'INCOMPLETE_FIXTURE');
});

test('duplicate is idempotent; conflicting run and source generation stays unknown',()=>{
 const {issuer,reader}=createSyntheticAccumulator(plan());const original=issuer.issue(rec());const duplicate=issuer.issue(rec());
 assert.equal(reader.observe(original).fixtureStatus,'RECORDED');assert.equal(reader.observe(duplicate).fixtureStatus,'DUPLICATE');
 assert.equal(reader.observe(issuer.issue(rec('fixture-run-a',{generationId:'fixture-other'}))).fixtureStatus,'UNKNOWN');
 assert.equal(reader.observe(original).reason,'CONFLICT');assert.equal(reader.report(issuer.seal()).fixtureStatus,'UNKNOWN');
});

test('scope, reused attempts and duplicate source event identities fail closed',()=>{
 for(const other of [
  rec('fixture-run-b',{workspaceId:'fixture-other'}),
  rec('fixture-run-b',{attemptId:'fixture-attempt-a'}),
  rec('fixture-run-b',{startSeq:2,endSeq:4}),
 ]) {
  const {issuer,reader}=createSyntheticAccumulator(plan());reader.observe(issuer.issue(rec()));assert.equal(reader.observe(issuer.issue(other)).fixtureStatus,'UNKNOWN');
  assert.equal(reader.report(issuer.seal()).fixtureStatus,'UNKNOWN');
 }
});

test('unobserved issued receipts and overflow cannot be certified complete',()=>{
 const one=createSyntheticAccumulator({ ...plan(),expectedRunIds:['fixture-run-a'] });const observed=one.issuer.issue(rec());one.issuer.issue(rec());one.reader.observe(observed);
 assert.equal(one.reader.report(one.issuer.seal()).reason,'INCOMPLETE_FIXTURE');
 const two=createSyntheticAccumulator({ ...plan(),expectedRunIds:['fixture-run-a'] });for(let i=0;i<64;i++)two.reader.observe(two.issuer.issue(rec()));
 assert.throws(()=>two.issuer.issue(rec()),errorCode('LIMIT'));assert.equal(two.reader.report(two.issuer.seal()).fixtureStatus,'UNKNOWN');
});

test('rejects getters, proxies, non-fixture identifiers and invalid sequences',()=>{
 let called=false;const bad=plan();Object.defineProperty(bad,'workspaceId',{get(){called=true;return 'fixture-workspace';}});
 assert.throws(()=>createSyntheticAccumulator(bad),errorCode('INVALID_INPUT'));assert.equal(called,false);
 const proxy=Proxy.revocable(plan(),{});proxy.revoke();assert.throws(()=>createSyntheticAccumulator(proxy.proxy),errorCode('INVALID_INPUT'));
 assert.throws(()=>createSyntheticAccumulator({...plan(),expectedRunIds:['real-data']}),errorCode('INVALID_INPUT'));
 const {issuer}=createSyntheticAccumulator(plan());
 for(const values of [{startSeq:-0},{endSeq:1},{startSeq:2,endSeq:2},{outcome:'unknown'},{sessionId:'real-session'}])assert.throws(()=>issuer.issue(rec('fixture-run-a',values)),errorCode('INVALID_INPUT'));
});

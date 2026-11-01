'use strict';
// Historical test body retained for review, but native execution is disabled:
// no verified native baseline or installed-module loader is available here.
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadFixtureClasses}=require('./fixture-baseline.cjs');
const nativeBaselineSkip = {skip: 'NATIVE_BASELINE_UNVERIFIED: no independent pin or native loader'};
async function fixture({fail=false,failCheckpoint=false}={}) {
 const [{Context},{TeamService}]=await loadFixtureClasses();
 const ctx=new Context();const events=[],calls=[],order=[];
 const state={members:[],tasks:[]};
 const root={id:'lead-session',options:{model:'inherited'},session:{header:{id:'lead-session'},inheritedEventCount:0,events:[],append(type,data){
  events.push({type,data});order.push(data.member.phase);
  const i=state.members.findIndex(m=>m.id===data.member.id);
  if(i<0)state.members.push(data.member);else state.members[i]=data.member;
 },snapshotEvents(){return [];}}};
 const live=new Map([[root.id,root]]);
 const agents={get(id){return live.get(id);},list(){return [];}};
 const sessions={get(){return undefined;},async flush(){order.push('flush');}};
 const projections={register(){return ()=>{};},stateOf(){return state;}};
 const subagents={async startActivation(input){calls.push(input);order.push('startActivation');if(fail)throw Error('synthetic provider failure');return {childId:input.childId,messageId:'message-id'};},async drainChildren(){order.push('drain');}};
 ctx.provide('agents',agents);ctx.provide('sessions',sessions);ctx.provide('sessionPersistence',{});ctx.provide('sessionProjections',projections);ctx.provide('subagents',subagents);
 await ctx.plugin(TeamService,{});
 // The fake in-memory child has no Session; this fixture isolates only team handling
 // after its native child checkpoint call, not actual session durability.
 ctx.agentTeams.roster.checkpointInitialPrompt=async()=>{order.push('checkpoint');if(failCheckpoint)throw Error('synthetic checkpoint failure');};
 return {ctx,root,events,calls,order,state,live};
}
const request=(name='alice')=>({name,description:'synthetic',prompt:[{type:'text',text:'synthetic'}],context:'fresh',provider:'spawn',signal:new AbortController().signal,agentOptions:{provider:'codex',model:'selected'},agentPreset:'preset'});

test('native baseline reserves before activation and drops unrecognized request overrides',nativeBaselineSkip,async()=>{
 const f=await fixture();try{
  const result=await f.ctx.agentTeams.spawnTeammate(f.root,request());
  assert.equal(result.member.name,'alice');
  assert.deepEqual(f.order,['provisioning','flush','startActivation','checkpoint','active','flush']);
  assert.equal(f.calls.length,1);
  assert.deepEqual(Object.keys(f.calls[0].request).sort(),['parent','prompt']);
  assert.equal(f.calls[0].delivery,'parent');
  assert.equal(f.calls[0].provider,'spawn');
  assert.equal(f.events[0].data.member.id,result.member.id);
 } finally {await f.ctx.fiber.dispose();}
});

test('native provider failure records failed member and name is not recycled',nativeBaselineSkip,async()=>{
 const f=await fixture({fail:true});try{
  await assert.rejects(f.ctx.agentTeams.spawnTeammate(f.root,request()),/synthetic provider failure/);
  assert.deepEqual(f.order,['provisioning','flush','startActivation','failed','flush','drain']);
  assert.equal(f.state.members[0].phase,'failed');
  await assert.rejects(f.ctx.agentTeams.spawnTeammate(f.root,request()),e=>e.code==='TEAM_MEMBER_NAME_TAKEN');
  assert.equal(f.calls.length,1);
 } finally {await f.ctx.fiber.dispose();}
});

test('native checkpoint failure marks failed, drains child, and never publishes active',nativeBaselineSkip,async()=>{
 const f=await fixture({failCheckpoint:true});try{
  await assert.rejects(f.ctx.agentTeams.spawnTeammate(f.root,request()),/synthetic checkpoint failure/);
  assert.deepEqual(f.order,['provisioning','flush','startActivation','checkpoint','failed','flush','drain']);
  assert.equal(f.state.members[0].phase,'failed');
 } finally {await f.ctx.fiber.dispose();}
});

test('native membership rejects stale caller and teammate cannot spawn',nativeBaselineSkip,async()=>{
 const f=await fixture();try{
  await assert.rejects(f.ctx.agentTeams.spawnTeammate({...f.root},request()),e=>e.code==='TEAM_NOT_MEMBER');
  assert.equal(f.events.length,0);assert.equal(f.calls.length,0);
  const teammate={id:'teammate-session',session:{header:{parentSession:f.root.id}}};
  f.live.set(teammate.id,teammate);
  f.state.members.push({id:teammate.id,name:'existing',phase:'active'});
  await assert.rejects(f.ctx.agentTeams.spawnTeammate(teammate,request('bob')),e=>e.code==='TEAM_LEAD_REQUIRED');
  assert.equal(f.events.length,0);assert.equal(f.calls.length,0);
 } finally {await f.ctx.fiber.dispose();}
});

module.exports={fixture};

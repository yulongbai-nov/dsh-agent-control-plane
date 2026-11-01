'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createGate}=require('../gate.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const fake=()=>{
 const log=[];let archived=false;
 return {log,adapter:{async setArchived(value){log.push(['persist',value]);archived=value;},async getArchived(){log.push(['reload']);return archived;},async send(value){log.push(['send',value]);return 'inbox-id';}}};
};

test('archive blocks messages until explicit wake, preserving exact original target',async()=>{
 const f=fake(),gate=createGate(f.adapter,'member-id');
 await gate.reconcile();f.log.length=0;
 await gate.archive();
 await assert.rejects(gate.send('during'),{code:'ARCHIVED'});
 await gate.wake();
 assert.equal(await gate.send('after'),'inbox-id');
 assert.deepEqual(f.log,[['persist',true],['persist',false],['send','after']]);
 assert.equal(gate.state(),'active');
});

test('send admitted first completes before archive crosses same queue',async()=>{
 const f=fake(),hold=deferred();
 f.adapter.send=async(value)=>{f.log.push(['send',value]);await hold.promise;return 'accepted';};
 const gate=createGate(f.adapter,'member-id');await gate.reconcile();f.log.length=0;
 const send=gate.send('before');const archive=gate.archive();
 await Promise.resolve();assert.deepEqual(f.log,[['send','before']]);
 hold.resolve();assert.equal(await send,'accepted');await archive;
 assert.deepEqual(f.log,[['send','before'],['persist',true]]);
});

test('archive admitted first prevents a racing send after durable write',async()=>{
 const f=fake(),hold=deferred();
 f.adapter.setArchived=async(value)=>{f.log.push(['persist',value]);await hold.promise;};
 const gate=createGate(f.adapter,'member-id');await gate.reconcile();f.log.length=0;
 const archive=gate.archive();const send=gate.send('during');
 const sendResult=assert.rejects(send,{code:'ARCHIVED'});
 await Promise.resolve();assert.deepEqual(f.log,[['persist',true]]);
 hold.resolve();await archive;await sendResult;
 assert.deepEqual(f.log,[['persist',true]]);
});

test('uncertain archive commit stops future writes until explicit authoritative reconciliation',async()=>{
 const f=fake();let first=true,archived=false;
 f.adapter.setArchived=async(value)=>{f.log.push(['persist',value]);archived=value;if(first){first=false;throw Error('failed after write');}};
 f.adapter.getArchived=async()=>{f.log.push(['reload']);return archived;};
 const gate=createGate(f.adapter,'member-id');
 await gate.reconcile();f.log.length=0;
 await assert.rejects(gate.archive(),{code:'UNCERTAIN'});assert.equal(gate.state(),'uncertain');
 await assert.rejects(gate.send('never'),{code:'UNCERTAIN'});await assert.rejects(gate.wake(),{code:'UNCERTAIN'});
 assert.deepEqual(f.log,[['persist',true]]);
 await gate.reconcile();assert.equal(gate.state(),'archived');
 await assert.rejects(gate.send('still denied'),{code:'ARCHIVED'});
 await gate.wake();assert.equal(await gate.send('okay'),'inbox-id');
});

test('failed send is propagated and never automatically resent',async()=>{
 const f=fake();let calls=0;
 f.adapter.send=async()=>{calls++;throw Error('acceptance unknown');};
 const gate=createGate(f.adapter,'member-id');await gate.reconcile();
 await assert.rejects(gate.send('x'),/acceptance unknown/);
 assert.equal(calls,1);
});

test('new reference gate starts unknown and refuses send until authoritative reconciliation',async()=>{
 const f=fake(),gate=createGate(f.adapter,'member-id');
 assert.equal(gate.state(),'uncertain');
 await assert.rejects(gate.send('must not auto-wake'),{code:'UNCERTAIN'});
 await gate.reconcile();
 assert.equal(gate.state(),'active');
});

test('failed wake may already unarchive and remains closed until reconciliation',async()=>{
 const f=fake();let archived=true;
 f.adapter.getArchived=async()=>archived;
 f.adapter.setArchived=async(value)=>{archived=value;throw Error('after write');};
 const gate=createGate(f.adapter,'member-id');await gate.reconcile();
 assert.equal(gate.state(),'archived');
 await assert.rejects(gate.wake(),{code:'UNCERTAIN'});
 await assert.rejects(gate.send('no'),{code:'UNCERTAIN'});
 await gate.reconcile();assert.equal(gate.state(),'active');
});

test('bad or failed recovery never reopens admission',async()=>{
 const f=fake();f.adapter.setArchived=async()=>{throw Error('uncertain');};
 const gate=createGate(f.adapter,'member-id');await gate.reconcile();f.adapter.getArchived=async()=>undefined;
 await assert.rejects(gate.archive(),{code:'UNCERTAIN'});
 await assert.rejects(gate.reconcile(),{code:'UNCERTAIN'});
 assert.equal(gate.state(),'uncertain');
 await assert.rejects(gate.send('no'),{code:'UNCERTAIN'});
});

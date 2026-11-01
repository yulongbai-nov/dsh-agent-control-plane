'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMemoryRecords}=require('../index.cjs');
const key={sessionId:'s',runId:'r'};
const start={type:'run-start',eventSeq:0};
const end={type:'run-end',eventSeq:3,outcome:'completed'};

test('watch emits after immutable commit in revision order, and unsubscribes',()=>{
 const records=createMemoryRecords();const observed=[];
 const off=records.subscribe(key,(notice)=>observed.push({notice,at:records.read(key)}));
 records.observe(key,start);records.observe(key,start);records.observe(key,end);off();
 assert.deepEqual(observed.map(({notice})=>notice),[{...key,revision:1},{...key,revision:2}]);
 assert.deepEqual(observed.map(({at})=>at.revision),[1,2]);
});

test('only matching session/run subscribers receive notices',()=>{
 const records=createMemoryRecords();const a=[],b=[];
 const other={sessionId:'other',runId:'r'};
 records.subscribe(key,(event)=>a.push(event));
 records.subscribe(other,(event)=>b.push(event));
 records.observe(key,start);
 assert.equal(a.length,1);assert.equal(b.length,0);
 records.observe(other,start);
 assert.equal(a.length,1);assert.equal(b.length,1);
});

test('synchronous throw is isolated and ordinary rejection is consumed best-effort',async()=>{
 const records=createMemoryRecords();
 records.subscribe(key,()=>{throw new Error('bad');});
 records.subscribe(key,()=>Promise.reject(new Error('bad async')));
 assert.equal(records.observe(key,start).revision,1);
 assert.equal(records.observe(key,end).revision,2);
 await new Promise((resolve)=>setImmediate(resolve));
});

test('listener reentry is rejected without breaking delivery to later listeners',()=>{
 const records=createMemoryRecords();const seen=[];
 records.subscribe(key,()=>assert.throws(()=>records.observe(key,end),{code:'REENTRANT'}));
 records.subscribe(key,(notice)=>seen.push(notice.revision));
 records.observe(key,start);
 assert.deepEqual(seen,[1]);assert.equal(records.read(key).revision,1);
});

test('all inbound getter, proxy and nested surprise fields are rejected without execution',()=>{
 const records=createMemoryRecords();let effects=0;
 const evil={};Object.defineProperty(evil,'eventSeq',{enumerable:true,get(){effects++;return 0;}});
 const proxy=new Proxy({},{get(){effects++;throw Error('trap');},ownKeys(){effects++;throw Error('trap');},getPrototypeOf(){effects++;throw Error('trap');}});
 for(const call of [()=>records.observe(key,evil),()=>records.observe(proxy,start),()=>records.observe(key,proxy),()=>records.read(proxy)]) assert.throws(call,{code:'INVALID_INPUT'});
 assert.equal(effects,0);
});

test('unsubscribed listener in current dispatch is not invoked after teardown',()=>{
 const records=createMemoryRecords();const calls=[];
 let offSecond;
 records.subscribe(key,()=>{calls.push('first');offSecond();});
 offSecond=records.subscribe(key,()=>calls.push('second'));
 records.observe(key,start);
 assert.deepEqual(calls,['first']);
});

test('listener return thenables are not observed or executed as input',()=>{
 const records=createMemoryRecords();let effects=0;
 const thenable={get then(){effects++;throw Error('untrusted thenable');}};
 records.subscribe(key,()=>thenable);
 assert.equal(records.observe(key,start).revision,1);
 assert.equal(effects,0);
});

test('two subscriptions of the same callback have independent lifetimes',()=>{
 const records=createMemoryRecords();let calls=0;const cb=()=>calls++;
 const first=records.subscribe(key,cb);const second=records.subscribe(key,cb);
 first();records.observe(key,start);assert.equal(calls,1);
 second();records.observe(key,end);assert.equal(calls,1);
});

test('options, subscribe keys, listener and inputs reject traps and accessors',()=>{
 let effects=0;
 const trap=()=>{effects++;throw Error('not allowed');};
 const proxy=new Proxy({}, {get:trap,getPrototypeOf:trap,ownKeys:trap});
 const revocable=Proxy.revocable({},{});revocable.revoke();
 const getter={};Object.defineProperty(getter,'maxRuns',{enumerable:true,get:trap});
 for(const options of [proxy,revocable.proxy,getter,{unknown:1},{maxRuns:0},{maxRuns:1025},{maxListeners:33}]) assert.throws(()=>createMemoryRecords(options),{code:'INVALID_INPUT'});
 const records=createMemoryRecords();
 assert.throws(()=>records.subscribe(proxy,()=>{}),{code:'INVALID_INPUT'});
 const fnProxy=new Proxy(()=>{}, {apply:trap});
 assert.throws(()=>records.subscribe(key,fnProxy),{code:'INVALID_INPUT'});
 const secret={};Object.defineProperty(secret,'script',{enumerable:true,get:trap});
 assert.throws(()=>records.observe(key,secret),{code:'INVALID_INPUT'});
 assert.throws(()=>records.read({sessionId:'s'.repeat(257),runId:'r'}),{code:'INVALID_INPUT'});
 assert.equal(effects,0);
});

test('versioned snapshots remain detached from caller mutation and unknown keys',()=>{
 const records=createMemoryRecords();
 const mutableKey={sessionId:'s',runId:'r'};
 const mutableStart={type:'run-start',eventSeq:0};
 records.observe(mutableKey,mutableStart);
 mutableKey.runId='other';mutableStart.eventSeq=42;
 const original=records.read(key);
 assert.equal(original.version,1);assert.equal(original.startEventSeq,0);
 assert.equal(records.read(mutableKey).state,'unknown');
 assert.deepEqual(records.observe(key,{type:'run-start',eventSeq:0}),original);
});

test('resource limits reject input without partial mutation',()=>{
 const records=createMemoryRecords({maxRuns:1,maxListeners:1});
 const off=records.subscribe(key,()=>{});
 assert.throws(()=>records.subscribe(key,()=>{}),{code:'LIMIT'});
 records.observe(key,start);
 assert.throws(()=>records.observe({sessionId:'s',runId:'other'},start),{code:'LIMIT'});
 assert.equal(records.read(key).revision,1);off();
});

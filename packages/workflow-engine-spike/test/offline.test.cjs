'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('detached observer failure does not replace original run or delay microtask',async()=>{
 const order=[];
 const original={id:'run',result:Promise.resolve({stopReason:'completed'})};
 class Parent {start(){order.push('parent');queueMicrotask(()=>order.push('work'));return original;}}
 class Research extends Parent {start(req){const run=super.start(req);try {Promise.resolve((()=>{order.push('observer');throw Error('fixture');})()).catch(()=>{});} catch {} return run;}}
 const run=new Research().start({});
 assert.strictEqual(run,original);
 assert.deepEqual(order,['parent','observer']);
 await run.result;
 assert.deepEqual(order,['parent','observer','work']);
});

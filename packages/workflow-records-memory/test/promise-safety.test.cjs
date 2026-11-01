'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const entry=require.resolve('../index.cjs');
const launch=(body)=>spawnSync(process.execPath,['--unhandled-rejections=strict','-e',`const {createMemoryRecords}=require(${JSON.stringify(entry)});const records=createMemoryRecords();const key={sessionId:'s',runId:'r'};${body}`],{encoding:'utf8',timeout:5000});

test('ordinary trusted listener rejecting promises are consumed without breaking later listeners',()=>{
 const result=launch(`records.subscribe(key,()=>Promise.reject(Error('synthetic'))); records.subscribe(key,()=>console.log('second')); const snap=records.observe(key,{type:'run-start',eventSeq:0}); console.log(snap.revision); setImmediate(()=>console.log('alive'));`);
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/second\s+1\s+alive/);
});

test('fallback ignores a replaced then on an otherwise normal native promise',()=>{
 const result=launch(`records.subscribe(key,()=>{const p=Promise.reject(Error('synthetic'));p.then=()=>{throw Error('should not read then')};return p});records.observe(key,{type:'run-start',eventSeq:0});setImmediate(()=>console.log('alive'));`);
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/alive/);
});

test('hostile promise constructor and species limits are observable without affecting parent runner',()=>{
 for(const kind of ['constructor','species']) {
  const setup=kind==='constructor' ? `Object.defineProperty(p,'constructor',{get(){throw Error('hostile constructor')}});` : `Object.defineProperty(p,'constructor',{value:{get [Symbol.species](){throw Error('hostile species')}}});`;
  const result=launch(`records.subscribe(key,()=>{const p=Promise.reject(Error('synthetic unhandled'));${setup}return Object.freeze(p)}); records.observe(key,{type:'run-start',eventSeq:0}); console.log('commit='+records.read(key).revision);`);
  assert.equal(result.status,1,`${kind}: ${result.stderr}`);
  assert.match(result.stdout,/commit=1/);
  assert.match(result.stderr,/synthetic unhandled/);
 }
});

test('a proxy around a rejected native promise is not inspected',()=>{
 const result=launch(`const p=Promise.reject(Error('synthetic proxy rejection'));const returned=new Proxy(p,{get(){throw Error('trap')}});records.subscribe(key,()=>returned);records.observe(key,{type:'run-start',eventSeq:0});console.log('commit='+records.read(key).revision);`);
 assert.equal(result.status,1,result.stderr);assert.match(result.stdout,/commit=1/);assert.match(result.stderr,/synthetic proxy rejection/);
});

test('custom thenable is not assimilated or read by notice delivery',()=>{
 const result=launch(`let reads=0; records.subscribe(key,()=>({get then(){reads++;throw Error('should not read');}})); records.observe(key,{type:'run-start',eventSeq:0}); setImmediate(()=>console.log('reads='+reads));`);
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/reads=0/);
});

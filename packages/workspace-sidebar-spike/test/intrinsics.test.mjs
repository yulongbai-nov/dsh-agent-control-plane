import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const moduleUrl = new URL('../index.mjs', import.meta.url).href;
const exec = code => spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:5000});

test('Map input iterator overrides after import are not used',()=>{
 const result=exec(`const {inspectCandidates}=await import(${JSON.stringify(moduleUrl)});let calls=0;const original=Map.prototype.entries;Map.prototype.entries=function(){calls++;throw Error('must not use')};const data={roots:['A'],catalogs:new Map([['A',{provenance:'caller-reviewed',state:'ready',entries:[]}]])};const out=inspectCandidates(data);Map.prototype.entries=original;console.log(JSON.stringify({status:out.status,calls}));`);
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{status:'complete',calls:0});
});

test('captured Map iterator next cannot be replaced after import',()=>{
 const result=exec(`const {inspectCandidates}=await import(${JSON.stringify(moduleUrl)});const proto=Object.getPrototypeOf(new Map().entries());const previous=proto.next;let calls=0;proto.next=function(){calls++;throw Error('trap')};const m=new Map();Map.prototype.set.call(m,'A',{provenance:'caller-reviewed',state:'ready',entries:[]});const out=inspectCandidates({roots:['A'],catalogs:m});proto.next=previous;console.log(JSON.stringify({status:out.status,calls}));`);
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{status:'complete',calls:0});
});

test('iterator count is bounded even when Map intrinsic was compromised before import',()=>{
 const result=exec(`const proto=Object.getPrototypeOf(new Map().entries());const previous=proto.next;let calls=0;proto.next=function(){calls++;return {done:false,value:['A',{provenance:'caller-reviewed',state:'ready',entries:[]}]}};const {inspectCandidates}=await import(${JSON.stringify(moduleUrl)});const result=inspectCandidates({roots:[],catalogs:new Map()});proto.next=previous;console.log(JSON.stringify({status:result.status,calls}));`);
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{status:'invalid',calls:1001});
});

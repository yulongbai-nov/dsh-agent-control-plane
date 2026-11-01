import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCandidates} from '../index.mjs';
const reviewed=(entries=[])=>({provenance:'caller-reviewed',state:'ready',entries});
const input=()=>({roots:['A'],catalogs:new Map([['A',reviewed([{id:'B',mode:'continuable'}])],['B',reviewed()]])});
const item=(result,parentId,childId)=>result.edges.find(e=>e.parentId===parentId && e.childId===childId);

test('every encountered root, record, entry and array accessor is rejected without invocation',()=>{
 let called=0;const getter=()=>{called++;return 'A';};
 for(const manipulate of [
  x=>Object.defineProperty(x,'roots',{get:getter}),
  x=>Object.defineProperty(x,'other',{get:getter}),
  x=>Object.defineProperty(x.roots,0,{get:getter}),
  x=>Object.defineProperty(x.catalogs.get('A'),'provenance',{get:getter}),
  x=>Object.defineProperty(x.catalogs.get('A'),'unrelated',{get:getter}),
  x=>Object.defineProperty(x.catalogs.get('A'),'entries',{get:getter}),
  x=>Object.defineProperty(x.catalogs.get('A').entries,0,{get:getter}),
  x=>Object.defineProperty(x.catalogs.get('A').entries[0],'mode',{get:getter}),
  x=>Object.defineProperty(x.catalogs.get('A').entries[0],'other',{get:getter}),
 ]) {const data=input();manipulate(data);assert.equal(inspectCandidates(data).status,'invalid');assert.equal(called,0);}
});

test('array index accessors cannot grow array or mutate map during validation',()=>{
 const x=input();let calls=0;
 Object.defineProperty(x.roots,0,{get(){calls++;x.roots.push('injected');x.catalogs.set('other',reviewed());return 'A';}});
 assert.equal(inspectCandidates(x).status,'invalid');assert.equal(calls,0);
 assert.equal(x.roots.length,1);assert.equal(x.catalogs.size,2);
 const y=input();
 Object.defineProperty(y.catalogs.get('A').entries,0,{get(){calls++;y.catalogs.get('A').entries.push({id:'extra',mode:'external'});return {id:'B',mode:'continuable'};}});
 assert.equal(inspectCandidates(y).status,'invalid');assert.equal(calls,0);
 assert.equal(y.catalogs.get('A').entries.length,1);
});

test('own Map getter is rejected before size or iterator access',()=>{
 const x=input();let calls=0;
 Object.defineProperty(x.catalogs,'size',{get(){calls++;return 0;}});
 assert.equal(inspectCandidates(x).status,'invalid');assert.equal(calls,0);
});

test('holes, inherited indices, hidden accessors, decorated arrays, Proxy and revoked inputs reject',()=>{
 const variants=[];
 const a=input();a.roots=Array(1);variants.push(a);
 const b=input();Object.defineProperty(b.roots,'extra',{get(){throw Error('unexpected');}});variants.push(b);
 const c=input();const entries=Array(1);c.catalogs.get('A').entries=entries;variants.push(c);
 const d=input();d.catalogs.get('A').entries=Object.setPrototypeOf([{id:'B',mode:'continuable'}],{0:{id:'B',mode:'continuable'}});variants.push(d);
 const e=input();e.catalogs=new Proxy(e.catalogs,{});variants.push(e);
 const f=input();const rev=Proxy.revocable([],{});rev.revoke();f.roots=rev.proxy;variants.push(f);
 for(const data of variants){const result=inspectCandidates(data);assert.equal(result.status,'invalid');assert.deepEqual(result.edges,[]);}
});

test('dense array index cannot be replaced by an unrelated extra own property',()=>{
 const a=input();delete a.roots[0];a.roots.extra='A';
 assert.equal(Reflect.ownKeys(a.roots).length,2);
 assert.equal(inspectCandidates(a).status,'invalid');
 const b=input(),entries=b.catalogs.get('A').entries;
 delete entries[0];entries.extra={id:'B',mode:'continuable'};
 assert.equal(Reflect.ownKeys(entries).length,2);
 assert.equal(inspectCandidates(b).status,'invalid');
});

test('unknown modes are unknown and incomplete, never traversed as real children',()=>{
 const x={roots:['A'],catalogs:new Map([
  ['A',reviewed([{id:'B',mode:'unknown'}])],
  ['B',reviewed([{id:'C',mode:'continuable'}])],['C',reviewed()],
 ])};
 const result=inspectCandidates(x);
 assert.equal(result.status,'incomplete');assert.equal(item(result,'A','B')?.status,'unknown');
 assert.equal(item(result,'B','C'),undefined);
 assert.ok(result.issues.some(issue=>issue.code==='UNKNOWN_MODE'&&issue.parentId==='A'));
});

test('catalog not supplied yields pending candidates, not globally confirmed ones',()=>{
 const x=input();x.roots.push('missing');
 const result=inspectCandidates(x);
 assert.equal(result.status,'incomplete');
 assert.equal(item(result,'A','B')?.status,'pending');
 assert.ok(result.issues.some(issue=>issue.code==='MISSING_CATALOG'&&issue.parentId==='missing'));
});

test('unavailable catalog marks otherwise valid edges pending without dropping external status',()=>{
 const x=input();x.roots.push('unavailable');
 x.catalogs.set('unavailable',{provenance:'caller-reviewed',state:'loading'});
 x.catalogs.get('A').entries.push({id:'E',mode:'external'});
 const result=inspectCandidates(x);
 assert.equal(result.status,'incomplete');assert.equal(item(result,'A','B').status,'pending');
 assert.equal(item(result,'A','E').status,'external');
});

test('supplied hidden branches cannot contain unexecuted accessors or malformed data',()=>{
 let calls=0;
 const entry={};Object.defineProperty(entry,'id',{get(){calls++;return 'hidden';}});
 const x={roots:['A'],catalogs:new Map([['A',reviewed([{id:'B',mode:'unknown'}])],['B',reviewed([entry])]])};
 assert.equal(inspectCandidates(x).status,'invalid');assert.equal(calls,0);
 const y=input();y.catalogs.get('B').state='loading';
 const hidden={};Object.defineProperty(hidden,'id',{get(){calls++;return 'hidden'}});
 y.catalogs.get('B').entries=[hidden];
 assert.equal(inspectCandidates(y).status,'invalid');assert.equal(calls,0);
});

test('unknown mode stays explicitly unknown even when its child id is ambiguous',()=>{
 const x={roots:['A','X'],catalogs:new Map([
  ['A',reviewed([{id:'B',mode:'unknown'}])],['X',reviewed([{id:'B',mode:'continuable'}])],['B',reviewed()],
 ])};
 const result=inspectCandidates(x);
 assert.equal(result.status,'incomplete');
 assert.equal(item(result,'A','B')?.status,'unknown');
 assert.equal(item(result,'X','B')?.status,'ambiguous');
 assert.ok(result.issues.some(issue=>issue.code==='UNKNOWN_MODE'&&issue.parentId==='A'));
 assert.ok(result.issues.some(issue=>issue.code==='AMBIGUOUS_IDENTITY'));
});

test('cycles, duplicate direct parents and conservative conflict detection remain stable',()=>{
 const x={roots:['A'],catalogs:new Map([
  ['A',reviewed([{id:'X',mode:'continuable'},{id:'Y',mode:'continuable'}])],
  ['X',reviewed([{id:'C',mode:'continuable'}])],
  ['Y',reviewed([{id:'C',mode:'continuable'},{id:'Z',mode:'continuable'}])],
  ['C',reviewed([{id:'Z',mode:'continuable'}])],['Z',reviewed()],
 ])};
 const out=inspectCandidates(x);
 assert.equal(item(out,'X','C').status,'ambiguous');assert.equal(item(out,'Y','C').status,'ambiguous');
 // C is suppressed, but its possibly reachable edge still conservatively marks Z ambiguous.
 assert.equal(item(out,'Y','Z').status,'ambiguous');assert.equal(item(out,'C','Z'),undefined);
});

test('catalogs and total edges enforce exact budget, including unreachable records',()=>{
 const entries=Array.from({length:999},(_,i)=>({id:`e-${i}`,mode:'external'}));
 const valid={roots:['A'],catalogs:new Map([['A',reviewed(entries)]])};
 assert.equal(inspectCandidates(valid).status,'complete');
 const invalid={roots:['A'],catalogs:new Map([['A',reviewed([...entries,{id:'extra',mode:'external'}])]])};
 assert.equal(inspectCandidates(invalid).status,'invalid');
 assert.equal(inspectCandidates({roots:[],catalogs:new Map(Array.from({length:1001},(_,i)=>[`k-${i}`,reviewed()]))}).status,'invalid');
});

// Synthetic public-source codec check; pass generated public-build artifacts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const names=['OLD_HOST','OLD_CLIENT','NEW_HOST','NEW_CLIENT'];
const paths=Object.fromEntries(names.map(name=>{
 const value=process.env[name];
 if(!value || !value.startsWith('/') || value.includes('.asar') || value.startsWith('/Applications/')) throw Error(`${name} must be a public-source build artifact`);
 return [name,resolve(value)];
}));
const [oldHost,oldClient,newHost,newClient]=await Promise.all(names.map(name=>import(pathToFileURL(paths[name]).href)));
const host=(m,name)=>m.TYPERT.invocations.find(item=>item.namespace==='session' && item.method===name);
const client=(m,name)=>m.TYPERT_REMOTE.methods[`session/${name}`];
const baseline={type:'baseline',value:{projections:{}}};
const projection={type:'projection',sessionId:'synthetic',key:'synthetic',value:null,seq:0};
const reset={type:'access-reset',value:{projections:{}}};
const unknown={type:'unknown-frame',value:{projections:{}}};

test('legacy and V2 host/client codecs enforce explicit protocol versions',()=>{
 assert.equal(host(oldHost,'controlV2'),undefined);assert.equal(client(oldClient,'controlV2'),undefined);
 for(const [name,legacy] of [['old host',host(oldHost,'control')],['old client',client(oldClient,'control')],['new host',host(newHost,'control')],['new client',client(newClient,'control')]]) {
  assert.ok(legacy,name);const codec=legacy.result.create();assert.equal(codec.safeParse(baseline).success,true,name);assert.equal(codec.safeParse(projection).success,true,name);assert.equal(codec.safeParse(reset).success,false,name);
 }
 for(const [name,v2] of [['new host',host(newHost,'controlV2')],['new client',client(newClient,'controlV2')]]) {
  assert.ok(v2,name);const codec=v2.result.create();assert.equal(codec.safeParse(baseline).success,true,name);assert.equal(codec.safeParse(projection).success,true,name);assert.equal(codec.safeParse(reset).success,true,name);assert.equal(codec.safeParse(unknown).success,false,name);
 }
});

// Opt-in isolated integration: compiled candidate graft, pinned rc.5 React,
// real Chromium, synthetic native row and Host. This is not full DSH E2E.
const fs=require('fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_PATH);
const frontend=fs.readFileSync(process.env.REACT_BUNDLE_PATH,'utf8');
assert.equal(createHash('sha256').update(frontend).digest('hex'),'0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0');
const start=frontend.indexOf('var l0={exports:{}},Te={};'),end=frontend.indexOf('var Th;const w2=',start);
assert.ok(start>=0&&end>start);
const react='function qs(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e}function P1(e){return e}\n'+frontend.slice(start,end)+'\nwindow.React=C;window.ReactDOM=Sn;window.ReactJSX=d;';
const lineagePath=process.env.R7_STAGED_ROWS?process.env.R7_STAGED_ROWS+'/shared-lineage.mjs':__dirname+'/../../session-tree/lineage.mjs';
const plannerPath=process.env.R7_STAGED_ROWS?process.env.R7_STAGED_ROWS+'/lineage-plan.mjs':__dirname+'/../candidate-src/client/rows/lineage-plan.mjs';
const lineage=fs.readFileSync(lineagePath,'utf8').replace('export { catalogOf, buildRows, navigationTarget };','window.lineage={buildRows,navigationTarget};');
const planner=fs.readFileSync(plannerPath,'utf8').replace(/import \{ buildRows, navigationTarget \} from '(?:\.\.\/\.\.\/\.\.\/\.\.\/session-tree\/lineage|\.\/shared-lineage)\.mjs';/,'const {buildRows,navigationTarget}=window.lineage;').replace('export function planLineage','window.planLineage=function planLineage');
const compiled=fs.readFileSync(process.env.GRAFT_COMPILED_PATH,'utf8')
 .replace('import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";','const {jsx:_jsx,jsxs:_jsxs}=window.ReactJSX;')
 .replace("import { Fragment, useEffect, useRef, useState } from 'react';",'const {Fragment,useEffect,useRef,useState}=window.React;')
 .replace("import { planLineage } from './lineage-plan.mjs';",'const planLineage=window.planLineage;')
 .replace('export function LineageGraft','window.LineageGraft=function LineageGraft');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND']});
 try {
  const requests=[],errors=[],context=await browser.newContext();await context.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent('<!doctype html><main id="mount"></main>');
  for(const content of [react,lineage,planner,compiled])await page.addScriptTag({content:`(()=>{${content}\n})();`});
  assert.deepEqual(errors,[],'setup browser errors');
  const result=await page.evaluate(async()=>{
   const summary=id=>({id,title:id,running:false,blank:false,retainedBy:{}}),child=id=>({id,mode:'continuable',label:id}),ready=a=>({state:'ready',values:{subagentCatalog:a}});
   const list={phase:'ready',ids:['root','other'],byId:{root:summary('root'),other:summary('other')},projectionsBySession:{root:ready([child('child')]),child:ready([child('deep')]),deep:ready([]),other:ready([])}};
   const calls=[], native=[];const refreshLineage=id=>{calls.push(id);return Promise.resolve()},openLineage=target=>calls.push(target);
   const root=ReactDOM.createRoot(document.querySelector('#mount'));
   const props={root:{id:'root',title:'root',blank:false},scopeRootIds:list.ids,list,statuses:new Map(),rowState:{archivedSessionIds:[],archivedFilter:'default'},t:(key,p={})=>`${key}:${p.title||''}`,refreshLineage,openLineage,renderNative:toggle=>React.createElement('div',{role:'treeitem','data-row-key':'session:root',onClick:()=>native.push('native')},toggle,'native root')};
   ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));
   const countBefore=calls.length,rootToggle=document.querySelector('[aria-label="lineage.expand:root"]');
   ReactDOM.flushSync(()=>rootToggle.click());await Promise.resolve();await Promise.resolve();
   const countAfterRoot=calls.slice(),nativeAfterToggle=native.slice();
   const childToggle=document.querySelector('[aria-label="lineage.expand:child"]');ReactDOM.flushSync(()=>childToggle.click());await Promise.resolve();await Promise.resolve();
   const deep=[...document.querySelectorAll('[data-lineage-key] button')].find(node=>node.textContent==='deep');deep.click();
   const afterOpen=calls.slice();
   const rootClose=document.querySelector('[aria-label="lineage.collapse:root"]');ReactDOM.flushSync(()=>rootClose.click());
   const afterClose=document.querySelectorAll('[data-lineage-key]').length;
   const reopen=document.querySelector('[aria-label="lineage.expand:root"]');ReactDOM.flushSync(()=>reopen.click());await Promise.resolve();await Promise.resolve();
   const afterReopen=[...document.querySelectorAll('[data-lineage-key]')].map(node=>node.textContent);
   const nativeKey=document.querySelector('[data-row-key]').dataset.rowKey;root.unmount();
   return {countBefore,countAfterRoot,nativeAfterToggle,afterOpen,afterClose,afterReopen,nativeKey};
  });
  assert.equal(result.countBefore,0);assert.deepEqual(result.countAfterRoot,['root']);assert.deepEqual(result.nativeAfterToggle,[]);
  assert.deepEqual(result.afterOpen,['root','child',{parentSessionId:'child',childSessionId:'deep',mode:'continuable'}]);
  assert.equal(result.afterClose,0);assert.equal(result.afterReopen.length,1);assert.equal(result.nativeKey,'session:root');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log(JSON.stringify(result,null,2));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

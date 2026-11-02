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
const planner=fs.readFileSync(plannerPath,'utf8').replace(/import \{ buildRows, navigationTarget \} from '(?:\.\.\/\.\.\/\.\.\/\.\.\/session-tree\/lineage|\.\/shared-lineage)\.mjs';/,'const {buildRows,navigationTarget}=window.lineage;').replaceAll('export function ','function ')+'\nwindow.planLineage=planLineage;window.canInspectScope=canInspectScope;';
const compiled=fs.readFileSync(process.env.GRAFT_COMPILED_PATH,'utf8')
 .replace('import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";','const {jsx:_jsx,jsxs:_jsxs}=window.ReactJSX;')
 .replace("import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';",'const {Fragment,useEffect,useId,useLayoutEffect,useRef,useState}=window.React;')
 .replace("import { canInspectScope, planLineage } from './lineage-plan.mjs';",'const {canInspectScope,planLineage}=window;')
 .replace('export function LineageGraft','window.LineageGraft=function LineageGraft');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND']});
 try {
  const requests=[],errors=[],context=await browser.newContext();await context.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent('<!doctype html><button id="outside">outside</button><main id="mount"></main>');
  for(const content of [react,lineage,planner,compiled])await page.addScriptTag({content:`(()=>{${content}\n})();`});
  assert.deepEqual(errors,[],'setup browser errors');
  const result=await page.evaluate(async()=>{
   const summary=id=>({id,title:id,running:false,blank:false,retainedBy:{}}),child=id=>({id,mode:'continuable',label:id}),ready=a=>({state:'ready',values:{subagentCatalog:a}});
   const list={phase:'ready',ids:['root','other'],byId:{root:summary('root'),other:summary('other')},projectionsBySession:{root:ready([child('child')]),child:ready([child('deep')]),deep:ready([]),other:ready([])}};
   const calls=[], native=[];const refreshLineage=id=>{calls.push(id);return Promise.resolve()},openLineage=target=>calls.push(target);
   const root=ReactDOM.createRoot(document.querySelector('#mount'));
   const props={root:{id:'root',title:'root',blank:false},scopeRootIds:list.ids,list,statuses:new Map(),rowState:{archivedSessionIds:[],archivedFilter:'default'},t:(key,p={})=>`${key}:${p.title||''}`,refreshLineage,openLineage,conflictedRoot:false,renderNative:(toggle,expanded,groupId)=>React.createElement('div',{role:'treeitem','data-row-key':'session:root','aria-expanded':expanded,'aria-owns':expanded?groupId:undefined,onClick:()=>native.push('native')},toggle,'native root')};
   ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));
   const countBefore=calls.length,rootToggle=document.querySelector('[aria-label="lineage.expand:root"]');
   ReactDOM.flushSync(()=>rootToggle.click());await Promise.resolve();await Promise.resolve();
   const countAfterRoot=calls.slice(),nativeAfterToggle=native.slice();
   const childToggle=document.querySelector('[aria-label="lineage.expand:child"]');ReactDOM.flushSync(()=>childToggle.click());await Promise.resolve();await Promise.resolve();
   let deep=[...document.querySelectorAll('[data-lineage-key] button')].find(node=>node.textContent==='deep');deep.click();
   const afterOpen=calls.slice();
   const nativeRoot=document.querySelector('[data-row-key="session:root"]'),ownedId=nativeRoot.getAttribute('aria-owns'),ownedGroup=document.getElementById(ownedId);
   const nestedGroup=deep.closest('[role="group"]'),nestedParent=nestedGroup?.parentElement?.querySelector(':scope > [data-lineage-controls] [data-lineage-open]')?.textContent;
   const ownership={expanded:nativeRoot.getAttribute('aria-expanded'),groupExists:ownedGroup?.getAttribute('role')==='group',nestedParent};
   const key=(node,name)=>node.dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));
   deep.focus();key(deep,'ArrowLeft');const left=document.activeElement?.textContent;key(document.activeElement,'ArrowRight');const right=document.activeElement?.textContent;
   key(document.activeElement,'Home');const home=document.activeElement?.getAttribute('aria-label');key(document.activeElement,'ArrowDown');const down=document.activeElement?.textContent;key(document.activeElement,'End');const end=document.activeElement?.textContent;
   const boundaryBubbled=key(document.activeElement,'ArrowDown');const keyboard={left,right,home,down,end,boundaryBubbled};
   key(document.activeElement,'ArrowLeft');const childControl=document.activeElement;ReactDOM.flushSync(()=>key(childControl,'ArrowLeft'));const collapsedWithFocus={deepAbsent:![...document.querySelectorAll('[data-lineage-open]')].some(node=>node.textContent==='deep'),focus:document.activeElement?.textContent};ReactDOM.flushSync(()=>key(childControl,'ArrowRight'));const deepRestored=[...document.querySelectorAll('[data-lineage-open]')].some(node=>node.textContent==='deep');deep=[...document.querySelectorAll('[data-lineage-open]')].find(node=>node.textContent==='deep');const tabBubbled=key(childControl,'Tab');
   deep.focus();ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));const stableFocus=document.activeElement===deep;
   deep.focus();list.projectionsBySession.child=ready([]);ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));const afterRemoval=document.activeElement?.textContent;
   list.projectionsBySession.child=ready([child('deep')]);ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));
   document.querySelector('#outside').focus();list.projectionsBySession.child=ready([]);ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));const outsideRetained=document.activeElement?.id;
   list.projectionsBySession.child=ready([child('deep')]);ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));
   document.querySelector('[data-lineage-open]:last-child')?.focus();document.body.tabIndex=-1;document.body.focus();list.projectionsBySession.child=ready([]);ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));const deliberateBody=document.activeElement===document.body;
   list.projectionsBySession.child=ready([child('deep')]);ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));
   const rootClose=document.querySelector('[aria-label="lineage.collapse:root"]');ReactDOM.flushSync(()=>rootClose.click());
   const afterClose=document.querySelectorAll('[data-lineage-key]').length;
   const reopen=document.querySelector('[aria-label="lineage.expand:root"]');ReactDOM.flushSync(()=>reopen.click());await Promise.resolve();await Promise.resolve();
   const afterReopen=[...document.querySelectorAll('[data-lineage-key]')].map(node=>node.textContent);
   props.rowState={archivedSessionIds:['child'],archivedFilter:'show'};ReactDOM.flushSync(()=>root.render(React.createElement(LineageGraft,props)));
   const archivedChild=document.querySelector('[data-lineage-key]');const archivedSemantics={rowDisabled:archivedChild?.getAttribute('aria-disabled'),toggleDisabled:archivedChild?.querySelector('[aria-label]')?.disabled,openDisabled:archivedChild?.querySelector('[data-lineage-open]')?.disabled};
   const archivedRootToggle=document.querySelector('[aria-label="lineage.collapse:root"]');archivedRootToggle.focus();key(archivedRootToggle,'ArrowDown');const archivedKeyboard=document.activeElement?.getAttribute('aria-label');
   const nativeKey=document.querySelector('[data-row-key]').dataset.rowKey;root.unmount();
   props.rowState={archivedSessionIds:[],archivedFilter:'default'};const duplicateRoot=ReactDOM.createRoot(document.querySelector('#mount'));ReactDOM.flushSync(()=>duplicateRoot.render(React.createElement(React.Fragment,null,React.createElement(LineageGraft,{...props,key:'one'}),React.createElement(LineageGraft,{...props,key:'two'}))));
   const toggles=[...document.querySelectorAll('[aria-label="lineage.expand:root"]')];toggles.forEach(toggle=>ReactDOM.flushSync(()=>toggle.click()));const owned=[...document.querySelectorAll('[data-row-key="session:root"]')].map(node=>node.getAttribute('aria-owns'));const duplicateIds={count:owned.length,distinct:new Set(owned).size,valid:owned.every(id=>!!id&&document.getElementById(id)?.getAttribute('role')==='group')};duplicateRoot.unmount();
   const secondMount=document.createElement('main');document.body.append(secondMount);const rootA=ReactDOM.createRoot(document.querySelector('#mount')),rootB=ReactDOM.createRoot(secondMount);ReactDOM.flushSync(()=>{rootA.render(React.createElement(LineageGraft,props));rootB.render(React.createElement(LineageGraft,props))});[...document.querySelectorAll('[aria-label="lineage.expand:root"]')].forEach(toggle=>ReactDOM.flushSync(()=>toggle.click()));const ownedSeparate=[...document.querySelectorAll('[data-row-key="session:root"]')].map(node=>node.getAttribute('aria-owns'));const separateRoots={count:ownedSeparate.length,distinct:new Set(ownedSeparate).size,valid:ownedSeparate.every(id=>!!id&&document.getElementById(id)?.getAttribute('role')==='group')};rootA.unmount();rootB.unmount();secondMount.remove();
   const blockedRoot=ReactDOM.createRoot(document.querySelector('#mount'));const beforeBlocked=calls.length;ReactDOM.flushSync(()=>blockedRoot.render(React.createElement(LineageGraft,{...props,conflictedRoot:true})));const blockedButton=document.querySelector('[aria-label="lineage.unavailable:root"]');blockedButton.click();await Promise.resolve();const blocked={disabled:blockedButton.disabled,nativePresent:!!document.querySelector('[data-row-key="session:root"]'),expanded:document.querySelector('[data-row-key="session:root"]').getAttribute('aria-expanded'),newCalls:calls.length-beforeBlocked};blockedRoot.unmount();
   const transitionRoot=ReactDOM.createRoot(document.querySelector('#mount'));ReactDOM.flushSync(()=>transitionRoot.render(React.createElement(LineageGraft,{...props,conflictedRoot:false})));ReactDOM.flushSync(()=>document.querySelector('[aria-label="lineage.expand:root"]').click());await Promise.resolve();ReactDOM.flushSync(()=>transitionRoot.render(React.createElement(LineageGraft,{...props,conflictedRoot:true})));await Promise.resolve();const hiddenOnConflict=document.querySelectorAll('[data-lineage-key]').length;ReactDOM.flushSync(()=>transitionRoot.render(React.createElement(LineageGraft,{...props,conflictedRoot:false})));await Promise.resolve();const transition={hiddenOnConflict,closedAfterRestore:!!document.querySelector('[aria-label="lineage.expand:root"]'),childrenAfterRestore:document.querySelectorAll('[data-lineage-key]').length};transitionRoot.unmount();
   const deferredRoot=ReactDOM.createRoot(document.querySelector('#mount'));const beforeDeferred=calls.length;ReactDOM.flushSync(()=>deferredRoot.render(React.createElement(LineageGraft,{...props,conflictedRoot:false})));ReactDOM.flushSync(()=>document.querySelector('[aria-label="lineage.expand:root"]').click());ReactDOM.flushSync(()=>deferredRoot.render(React.createElement(LineageGraft,{...props,conflictedRoot:true})));await Promise.resolve();await Promise.resolve();const deferredCalls=calls.length-beforeDeferred;deferredRoot.unmount();
   const incompleteRoot=ReactDOM.createRoot(document.querySelector('#mount'));delete list.byId.other;const beforeIncomplete=calls.length;ReactDOM.flushSync(()=>incompleteRoot.render(React.createElement(LineageGraft,{...props,conflictedRoot:false})));const incompleteButton=document.querySelector('[aria-label="lineage.unavailable:root"]');incompleteButton.click();await Promise.resolve();const incomplete={disabled:incompleteButton.disabled,nativePresent:!!document.querySelector('[data-row-key="session:root"]'),newCalls:calls.length-beforeIncomplete};incompleteRoot.unmount();
   return {countBefore,countAfterRoot,nativeAfterToggle,afterOpen,ownership,keyboard,collapsedWithFocus,deepRestored,tabBubbled,stableFocus,afterRemoval,outsideRetained,deliberateBody,afterClose,afterReopen,archivedSemantics,archivedKeyboard,nativeKey,duplicateIds,separateRoots,blocked,transition,deferredCalls,incomplete};
  });
  assert.equal(result.countBefore,0);assert.deepEqual(result.countAfterRoot,['root']);assert.deepEqual(result.nativeAfterToggle,[]);
  assert.deepEqual(result.afterOpen,['root','child',{parentSessionId:'child',childSessionId:'deep',mode:'continuable'}]);
  assert.deepEqual(result.ownership,{expanded:'true',groupExists:true,nestedParent:'child'});
  assert.deepEqual(result.keyboard,{left:'child',right:'deep',home:'lineage.collapse:root',down:'child',end:'deep',boundaryBubbled:true});
  assert.deepEqual(result.collapsedWithFocus,{deepAbsent:true,focus:'child'});assert.equal(result.deepRestored,true);assert.equal(result.tabBubbled,true);
  assert.equal(result.stableFocus,true);assert.equal(result.afterRemoval,'child');assert.equal(result.outsideRetained,'outside');assert.equal(result.deliberateBody,true);
  assert.equal(result.afterClose,0);assert.equal(result.afterReopen.length,1);assert.equal(result.nativeKey,'session:root');
  assert.deepEqual(result.archivedSemantics,{rowDisabled:null,toggleDisabled:false,openDisabled:true});
  assert.equal(result.archivedKeyboard,'lineage.expand:child');
  assert.deepEqual(result.duplicateIds,{count:2,distinct:2,valid:true});
  assert.deepEqual(result.separateRoots,{count:2,distinct:2,valid:true});
  assert.deepEqual(result.blocked,{disabled:true,nativePresent:true,expanded:null,newCalls:0});
  assert.deepEqual(result.transition,{hiddenOnConflict:0,closedAfterRestore:true,childrenAfterRestore:0});
  assert.equal(result.deferredCalls,0,'scope loss prevents a not-yet-issued refresh');
  assert.deepEqual(result.incomplete,{disabled:true,nativePresent:true,newCalls:0});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log(JSON.stringify(result,null,2));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

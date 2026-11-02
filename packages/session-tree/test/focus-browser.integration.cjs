const fs=require('fs');
const { chromium }=require(process.env.PLAYWRIGHT_PATH);
const {createHash}=require('node:crypto');
const source=fs.readFileSync(process.env.REACT_BUNDLE_PATH,'utf8');
if(createHash('sha256').update(source).digest('hex')!=='0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0') throw Error('Unexpected rc.5 frontend bundle');
const first=source.indexOf('var l0={exports:{}},Te={};');
const last=source.indexOf('var Th;const w2=',first);
if(first<0||last<0)throw Error('React bundle boundaries not found');
const react='function qs(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e} function P1(e){return e}\n'+source.slice(first,last)+'\nwindow.React=C;window.ReactDOM=Sn;';
const client=fs.readFileSync(__dirname+'/../client.js','utf8');
(async()=>{
 const browser=await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND']});
 try {
 const blockedRequests=[]; const context=await browser.newContext(); await context.route('**/*',r=>{blockedRequests.push(r.request().url()); return r.abort();});
 const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.setContent('<!doctype html><button id="outside">outside</button><main id="mount"></main>');
 await page.addScriptTag({content:react});
 await page.evaluate(()=>{window.__ModuleLoader__={load(spec){window.plugin=spec.factory(id=>{if(id==='react')return window.React;throw Error(id)})}}});
 await page.addScriptTag({content:client});
 for (const strict of [false,true]) {
 const out=await page.evaluate(async(strict)=>{
  let component,actions;
  const locale={register(){return ()=>{}},bind(){return key=>key}};
  const ctx={locale,effect(fn){fn()},slots:{inject(_,fn){fn()},register(options,c){if(options.name==='main'){component=c;actions=options.inject()}}},sessions:{refreshProjections(){},refresh(){}},uiWorkspace:{openSession(){}}};plugin.apply(ctx);
  const summary=id=>({id,title:id,running:false,blank:false,retainedBy:{}}), child=id=>({id,mode:'continuable',label:id}),ready=entries=>({state:'ready',error:null,values:{subagentCatalog:entries}});
  const list={phase:'ready',ids:['root','other'],byId:{root:summary('root'),other:summary('other')},projectionsBySession:{root:ready([child('a')]),a:ready([child('deep')]),deep:ready([]),other:ready([])}};
  actions.expansion.add('root');actions.expansion.add('a');actions.expansion.add('other');
  const props={...actions,t:key=>key,useSessions:select=>select(list),useSessionStatus:select=>select(new Map()),useWorkspaces:select=>select({archivedSessionIds:[]})};
  const root=ReactDOM.createRoot(document.querySelector('#mount'));const render=()=>ReactDOM.flushSync(()=>root.render(strict ? React.createElement(React.StrictMode,null,React.createElement(component,props)) : React.createElement(component,props)));
  const active=()=>({id:document.activeElement?.dataset?.sessionId??null,tag:document.activeElement?.tagName,html:document.activeElement?.outerHTML?.slice(0,130)});
  render(); const row=id=>document.querySelector(`[data-session-id="${id}"]`); row('deep').focus();let before=active();const sameNode=row('deep');render();let stable={...active(),sameNode:document.activeElement===sameNode};
  list.projectionsBySession.other=ready([child('a')]);render();let dup=active();
  list.projectionsBySession.other=ready([]);render();row('deep').focus();list.projectionsBySession.root=ready([]);list.projectionsBySession.other=ready([child('a')]);render();let moved=active();
  list.projectionsBySession.other=ready([]);list.projectionsBySession.root=ready([child('a')]);render();row('deep').focus();document.querySelector('#outside').focus();list.projectionsBySession.other=ready([child('a')]);render();let outside=active();
  list.projectionsBySession.other=ready([]);render();row('deep').focus();document.body.tabIndex=-1;document.body.focus();list.projectionsBySession.other=ready([child('a')]);render();let deliberateBody=active();
  list.projectionsBySession.other=ready([]);render();row('deep').querySelector('select').focus();list.projectionsBySession.other=ready([child('a')]);render();let controlRemoved=active();
  list.projectionsBySession.other=ready([]);render();row('deep').focus();list.ids=[];render();let noRoots=active();
  root.unmount();return {react:React.version,before,stable,dup,moved,outside,deliberateBody,controlRemoved,noRoots};
 },strict);
 const assert=require('node:assert/strict');assert.equal(out.before.id,'deep');assert.equal(out.stable.sameNode,true);assert.equal(out.dup.id,'root');assert.equal(out.moved.id,'deep');assert.equal(out.outside.html.includes('id="outside"'),true);assert.equal(out.deliberateBody.tag,'BODY');assert.equal(out.controlRemoved.tag,'BODY');assert.equal(out.noRoots.tag,'BODY');
 console.log(JSON.stringify({strict,...out},null,2));
 }
 require('node:assert/strict').deepEqual(errors,[],'unexpected browser errors');
 require('node:assert/strict').deepEqual(blockedRequests,[],'unexpected browser requests');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});

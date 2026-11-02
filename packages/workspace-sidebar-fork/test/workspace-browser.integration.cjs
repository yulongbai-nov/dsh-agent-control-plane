// Isolated Chromium test of the full built WorkspaceBrowser, with synthetic
// Host/store adapters and synthetic visual primitives. Not DSH Host/GUI E2E.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_PATH),sha=x=>createHash('sha256').update(x).digest('hex');
const front=fs.readFileSync(process.env.REACT_BUNDLE_PATH,'utf8'),bundle=fs.readFileSync(process.env.R7_BUNDLE_PATH,'utf8');
assert.equal(sha(front),'0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0','unexpected rc.5 React source');
assert.equal(sha(bundle),'a74cc2632f7e23329a0bb6bcdd534d369164fa25ff921d5d47373dfb24754670','unexpected candidate bundle');
const first=front.indexOf('var l0={exports:{}},Te={};'),last=front.indexOf('var Th;const w2=',first);assert.ok(first>=0&&last>first);
const react='function qs(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e}function P1(e){return e}\n'+front.slice(first,last)+'\nwindow.React=C;window.ReactDOM=Sn;window.ReactJSX=d;';
const marker='exports.inject = inject;';assert.equal(bundle.split(marker).length,2);
// Instrument the in-memory string only to expose the otherwise private component.
const instrumented=bundle.replace(marker,marker+' exports.__Browser=WorkspaceBrowser; exports.__dictionary=en;');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND']});
 try{
  const errors=[],requests=[],context=await browser.newContext();await context.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.setContent('<!doctype html><div id="mount"></div>');
  await page.addScriptTag({content:`(()=>{${react}\n})();`});
  await page.evaluate(()=>{window.__ModuleLoader__={load(reg){window.registration=reg}}});
  await page.addScriptTag({content:instrumented});
  await page.evaluate(()=>{
   const React=window.React,fragment=props=>React.createElement(React.Fragment,null,props.children),icon=()=>null;
   const visuals=new Proxy({HoverCard:props=>props.anchor,HoverCardGroup:props=>React.createElement('div',{className:props.className},props.children),Tooltip:fragment,Menu:props=>React.createElement(React.Fragment,null,props.anchor,props.open&&props.children),Modal:()=>null,Button:props=>React.createElement('button',{onClick:props.onClick,type:'button'},props.children),relativeTime:()=>'',writeClipboard:()=>Promise.resolve()}, {get:(target,key)=>key in target?target[key]:icon});
   const modules={'react':React,'react/jsx-runtime':window.ReactJSX,'@deepseek-ai/dsh-client-ui-primitives':visuals,'@deepseek-ai/cordis':{Service:class{}},'@deepseek-ai/dsh-client-store':{}};
   const plugin=window.registration.factory(id=>{if(!(id in modules))throw Error('unexpected module '+id);return modules[id]});
   const summary=id=>({id,title:id,displayTitle:id,running:false,blank:false,updatedAt:1,retainedBy:{}}),child=id=>({id,mode:'continuable',label:id}),ready=entries=>({state:'ready',values:{subagentCatalog:entries}});
   const ids=Array.from({length:7},(_,i)=>`root${i+1}`),byId=Object.fromEntries(ids.map(id=>[id,summary(id)]));
   const list={phase:'ready',ids,byId,projectionsBySession:{root1:ready([child('child')]),child:ready([child('deep')]),deep:ready([])}};
   const workspaces={items:[{workspaceId:'alpha',path:'/synthetic/alpha',title:'Alpha',sessionIds:ids,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}],archivedSessionIds:[],pinnedSessionIds:[],phase:'ready',state:'idle'};
   let state={groupBy:'workspace',orderBy:'manual',groupExpansion:{alpha:true},sessionOrderByAccount:{},archivedFilter:'default'};
   const listeners=new Set(),publish=()=>{state={...state};for(const f of listeners)f()},calls=[];
   const actions={setGroupExpanded:(key,value)=>{state.groupExpansion={...state.groupExpansion,[key]:value};publish()},retainAccountKeys:()=>{},syncSessionOrders:()=>{},setSessionOrder:()=>{},setArchivedFilter:()=>{}};
   const hook=value=>selector=>selector(value),t=(key,params={})=>(plugin.__dictionary[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(params[k]??''));
   const props={wide:true,usePanelInfo:hook({activePanelId:null}),expandSidebar:()=>{},useSessions:hook(list),useSessionStatus:hook(new Map()),useWorkspaces:hook(workspaces),useStore:select=>select(React.useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>state)),actions,startSession:()=>{},open:id=>calls.push(['native',id]),refreshLineage:id=>{calls.push(['refresh',id]);return Promise.resolve()},openLineage:target=>calls.push(['lineage',target]),requestSessionRename:()=>{},notifyArchivedNotOpenable:()=>{},renameWorkspace:()=>Promise.resolve(),deleteWorkspace:()=>Promise.resolve(),insertWorkspaceBefore:()=>Promise.resolve(),unarchiveSession:()=>Promise.resolve(),createWorkspace:()=>Promise.resolve(),searchSessions:()=>Promise.resolve({items:[],hasMore:false}),searchResultLimit:20,useDirectoryFlow:hook(false),useHostInfo:hook({home:undefined,isLoopback:true}),useShortcuts:hook([]),useWorkspaceShortcuts:hook({}),requestSearch:()=>{},requestAddWorkspace:()=>{},closeAddWorkspace:()=>{},setDirectoryBusy:()=>{},renderSlot:()=>null,t};
   const root=window.ReactDOM.createRoot(document.querySelector('#mount'));window.fixture={calls,setCatalog:(id,entries)=>{list.projectionsBySession[id]=ready(entries);publish()},showArchived:ids=>{workspaces.archivedSessionIds=ids;state.archivedFilter='show';publish()},setGroupBy:value=>{state.groupBy=value;publish()},close:()=>root.unmount()};root.render(React.createElement(plugin.__Browser,props));
  });
  await page.waitForSelector('[data-row-key="session:root1"]');
  const rootRows=()=>page.locator('[data-row-key^="session:"]').count();
  assert.equal(await rootRows(),5,'native group watermark remains five');
  await page.getByRole('button',{name:'Show 2 more sessions'}).click();assert.equal(await rootRows(),7,'native overflow reveals roots');
  const toggle=page.getByRole('button',{name:'Expand subagents of root1'});await toggle.focus();await page.keyboard.press('Space');
  await page.getByText('child',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.fixture.calls),[['refresh','root1']]);
  await page.getByRole('button',{name:'Expand subagents of child'}).click();await page.getByText('deep',{exact:true}).click();
  assert.deepEqual((await page.evaluate(()=>window.fixture.calls)).slice(-2),[['refresh','child'],['lineage',{parentSessionId:'child',childSessionId:'deep',mode:'continuable'}]]);
  await page.getByRole('button',{name:'deep'}).focus();await page.evaluate(()=>window.fixture.setCatalog('child',[]));
  await page.waitForFunction(()=>!document.querySelector('[data-lineage-key*="deep"]'));
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'child','focus returns to the surviving ancestor');
  await page.evaluate(()=>window.fixture.setCatalog('child',[{id:'deep',mode:'continuable',label:'deep'}]));await page.getByRole('button',{name:'deep'}).waitFor();
  await page.getByRole('button',{name:'Expand subagents of root2'}).focus();await page.evaluate(()=>window.fixture.setCatalog('child',[]));
  await page.waitForFunction(()=>!document.querySelector('[data-lineage-key*="deep"]'));
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Expand subagents of root2','unrelated control retains focus');
  await page.evaluate(()=>window.fixture.setCatalog('child',[{id:'deep',mode:'continuable',label:'deep'}]));await page.getByRole('button',{name:'deep'}).waitFor();
  await page.getByRole('button',{name:'deep'}).focus();await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();window.fixture.setCatalog('child',[])});
  await page.waitForFunction(()=>!document.querySelector('[data-lineage-key*="deep"]'));
  assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'BODY','deliberate body focus remains untouched');
  await page.evaluate(()=>{window.fixture.setCatalog('child',[{id:'deep',mode:'continuable',label:'deep'}]);window.fixture.showArchived(['child'])});
  const archivedRow=page.locator('[data-lineage-key]').filter({has:page.getByRole('button',{name:'child',exact:true})});
  assert.equal(await archivedRow.getAttribute('aria-disabled'),null,'expandable archived row is not wholly disabled');
  assert.equal(await archivedRow.getByRole('button',{name:'child',exact:true}).isDisabled(),true,'archived open is disabled');
  assert.equal(await archivedRow.locator('button[aria-label*="subagents of child"]').isDisabled(),false,'expansion remains enabled');
  await page.evaluate(()=>window.fixture.setGroupBy('flat'));await page.waitForSelector('[data-row-key="session:root7"]');assert.equal(await rootRows(),7,'flat mode keeps native roots');
  await page.getByRole('button',{name:'Search sessions'}).click();const input=page.getByPlaceholder('Search session names');await input.fill('root1');await page.getByRole('tree',{name:'Search results'}).waitFor();
  assert.ok(await page.getByText('root1',{exact:true}).count(),'native search returns matching root');
  await page.evaluate(()=>window.fixture.close());assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log('WorkspaceBrowser synthetic Chromium integration passed: watermark, grouped/flat, keyboard toggle, direct-parent navigation, search.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

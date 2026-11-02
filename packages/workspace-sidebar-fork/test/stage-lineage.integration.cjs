// Opt-in synthetic staging test; no upstream project or DSH app is launched.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),verifyTs6=require('./verify-ts6.cjs');
if(!process.env.TSC_ENTRY||!process.env.R7_STAGE_TEST_BASE)throw Error('Set TSC_ENTRY and R7_STAGE_TEST_BASE');
const {entry,packageRoot}=verifyTs6(process.env.TSC_ENTRY),ts=require(path.join(packageRoot,'lib/typescript.js'));
const root=path.resolve(__dirname,'..'),src=path.join(root,'candidate-src/client/rows'),graft=fs.readFileSync(path.join(src,'LineageGraft.tsx'),'utf8');
const compiled=ts.transpileModule(graft,{fileName:'LineageGraft.tsx',compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2024,jsx:ts.JsxEmit.ReactJSX,rewriteRelativeImportExtensions:true}}).outputText;
const work=fs.mkdtempSync(path.join(process.env.R7_STAGE_TEST_BASE,'r7-stage-'));
function tree(name,source=compiled){const dir=path.join(work,name),rows=path.join(dir,'client/rows');fs.mkdirSync(rows,{recursive:true});fs.writeFileSync(path.join(rows,'LineageGraft.js'),source);return dir}
function run(dir,overrides={}){return cp.spawnSync(process.execPath,[path.join(root,'staging/stage-lineage.cjs')],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:work,TMPDIR:work,TSC_ENTRY:entry,R7_EMIT_DIR:dir,...overrides}})}
(async()=>{
 const first=tree('one'),second=tree('two');const a=run(first),b=run(second);assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);assert.deepEqual(JSON.parse(a.stdout),JSON.parse(b.stdout));
 const staged=await import(pathToFileURL(path.join(first,'client/rows/lineage-plan.mjs')).href);
 const list={ids:['root'],byId:{root:{id:'root',title:'root',running:false,retainedBy:{}}},projectionsBySession:{root:{state:'ready',values:{subagentCatalog:[{id:'child',mode:'continuable',label:'child'}]}},child:{state:'ready',values:{subagentCatalog:[]}}}};
 const rows=staged.planLineage({rootId:'root',scopeRootIds:['root'],list,expanded:new Set(['root']),archived:new Set(),statuses:new Map(),archivedFilter:'default'});
 assert.deepEqual(rows.map(row=>row.target),[{parentSessionId:'root',childSessionId:'child',mode:'continuable'}]);
 const replay=run(first);assert.notEqual(replay.status,0);assert.match(replay.stderr,/target already exists/);
 const badPlanner=path.join(work,'bad-planner.mjs');fs.writeFileSync(badPlanner,fs.readFileSync(path.join(src,'lineage-plan.mjs'),'utf8')+'\n// drift\n');
 const third=tree('three'),drift=run(third,{R7_PLANNER_SOURCE:badPlanner});assert.notEqual(drift.status,0);assert.match(drift.stderr,/planner source drift/);assert.equal(fs.existsSync(path.join(third,'client/rows/lineage-plan.mjs')),false);
 const fourth=tree('four',compiled+'\n// drift\n'),badEmit=run(fourth);assert.notEqual(badEmit.status,0);assert.match(badEmit.stderr,/Emitted graft differs/);assert.equal(fs.existsSync(path.join(fourth,'client/rows/shared-lineage.mjs')),false);
 const badGraft=path.join(work,'bad-graft.tsx');fs.writeFileSync(badGraft,graft+'\n// drift\n');const fifth=tree('five'),graftDrift=run(fifth,{R7_GRAFT_SOURCE:badGraft});assert.notEqual(graftDrift.status,0);assert.match(graftDrift.stderr,/graft source drift/);assert.equal(fs.existsSync(path.join(fifth,'client/rows/lineage-plan.mjs')),false);
 const badShared=path.join(work,'bad-shared.mjs');fs.writeFileSync(badShared,fs.readFileSync(path.join(root,'../session-tree/lineage.mjs'),'utf8')+'\n// drift\n');const sixth=tree('six'),sharedDrift=run(sixth,{R7_SHARED_SOURCE:badShared});assert.notEqual(sharedDrift.status,0);assert.match(sharedDrift.stderr,/shared lineage source drift/);assert.equal(fs.existsSync(path.join(sixth,'client/rows/lineage-plan.mjs')),false);
 console.log('Synthetic staging checks passed; fixtures retained at '+work);
})().catch(error=>{console.error(error);process.exitCode=1});

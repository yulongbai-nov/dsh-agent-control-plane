// Experimental staging transform for a separately emitted candidate tree.
// Never runs tsc/tsdown or changes the installed DSH app. Inputs and output are
// verified before creating either new file; existing targets are never replaced.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const verifyTs6=require('../test/verify-ts6.cjs');
const {R7_EMIT_DIR,TSC_ENTRY}=process.env;
if(!R7_EMIT_DIR||!TSC_ENTRY)throw Error('Set R7_EMIT_DIR and TSC_ENTRY');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const root=path.resolve(__dirname,'..'),src=path.join(root,'candidate-src/client/rows');
const graftPath=process.env.R7_GRAFT_SOURCE||path.join(src,'LineageGraft.tsx');
const plannerPath=process.env.R7_PLANNER_SOURCE||path.join(src,'lineage-plan.mjs');
const lineagePath=process.env.R7_SHARED_SOURCE||path.join(root,'../session-tree/lineage.mjs');
const readPinned=(name,file,sha)=>{const value=fs.readFileSync(file);if(digest(value)!==sha)throw Error(`${name} source drift`);return value.toString('utf8')};
const graft=readPinned('graft',graftPath,'66a99090e329d67337a111f48f8be96aa20ff19e9c4bbd9dbcbd946fcd6ef75f');
const planner=readPinned('planner',plannerPath,'5f692d6ef7cb2d9e3c760062785dc6d896aa947088242c550194a1f0a290a08f');
const lineage=readPinned('shared lineage',lineagePath,'1ab69beaf3616ff4065dcea165790457e3e3e50d2de10cb6d4b0cb10555edb33');
const {packageRoot}=verifyTs6(TSC_ENTRY),ts=require(path.join(packageRoot,'lib/typescript.js'));
const out=ts.transpileModule(graft,{fileName:'LineageGraft.tsx',compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2024,jsx:ts.JsxEmit.ReactJSX,rewriteRelativeImportExtensions:true}}).outputText;
const emit=path.resolve(R7_EMIT_DIR),rows=path.join(emit,'client/rows'),graftJs=path.join(rows,'LineageGraft.js');
for(const p of [emit,path.join(emit,'client'),rows,graftJs])if(fs.lstatSync(p).isSymbolicLink())throw Error(`Symlink in emitted target: ${p}`);
const actual=fs.readFileSync(graftJs,'utf8').replace(/\n?\/\/# sourceMappingURL=LineageGraft\.js\.map\s*$/,'');
if(actual.trimEnd()!==out.trimEnd())throw Error('Emitted graft differs from pinned TS6 source');
const oldImport="import { buildRows, navigationTarget } from '../../../../session-tree/lineage.mjs';",newImport="import { buildRows, navigationTarget } from './shared-lineage.mjs';";
if(planner.split(oldImport).length!==2)throw Error('Planner import seam mismatch');
if(!out.includes("from './lineage-plan.mjs'"))throw Error('Emitted graft planner seam mismatch');
const stagedPlanner=planner.replace(oldImport,newImport),files=[['lineage-plan.mjs',stagedPlanner],['shared-lineage.mjs',lineage]];
for(const [name] of files)if(fs.existsSync(path.join(rows,name)))throw Error(`Staging target already exists: ${name}`);
for(const [name,content] of files)fs.writeFileSync(path.join(rows,name),content,{flag:'wx'});
console.log(JSON.stringify({typescript:ts.version,files:Object.fromEntries(files.map(([name,content])=>[name,digest(content)]))}));

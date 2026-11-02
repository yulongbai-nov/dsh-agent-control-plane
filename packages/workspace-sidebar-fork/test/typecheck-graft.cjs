// Optional local diagnostic only: these intentionally narrow stubs are NOT the
// upstream workspace types. Verify every file of the exact lockfile-pinned
// TypeScript tarball before executing any caller-supplied compiler.
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process'),verifyTs6=require('./verify-ts6.cjs');
if(!process.env.TSC_ENTRY||!process.env.R7_TYPECHECK_BASE)throw Error('Set TSC_ENTRY and R7_TYPECHECK_BASE');
const {entry}=verifyTs6(process.env.TSC_ENTRY);
const target=fs.mkdtempSync(path.join(process.env.R7_TYPECHECK_BASE,'r7-graft-'));
fs.cpSync(path.join(__dirname,'type-stubs'),target,{recursive:true});
const rows=path.join(target,'client/rows');fs.mkdirSync(rows,{recursive:true});
for(const name of ['LineageGraft.tsx','lineage-plan.d.mts'])fs.copyFileSync(path.join(__dirname,'../candidate-src/client/rows',name),path.join(rows,name));
const result=cp.spawnSync(process.execPath,[entry,'-p',path.join(target,'tsconfig.json')],{encoding:'utf8',env:{HOME:target,TMPDIR:target,PATH:'/usr/bin:/bin'}});
if(result.error)throw result.error;
process.stdout.write(result.stdout);process.stderr.write(result.stderr);
console.log(`Stub diagnostic source retained at ${target}`);
process.exitCode=result.status??1;

// Optional local diagnostic only: these intentionally narrow stubs are NOT the
// upstream workspace types. Verify every file of the exact lockfile-pinned
// TypeScript tarball before executing any caller-supplied compiler.
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process'),crypto=require('node:crypto');
if(!process.env.TSC_ENTRY||!process.env.R7_TYPECHECK_BASE)throw Error('Set TSC_ENTRY and R7_TYPECHECK_BASE');
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
const manifestBytes=fs.readFileSync(path.join(__dirname,'typescript-6.0.3-files.json'));
if(sha256(manifestBytes)!=='b0e8e509a0906d501c032340bf172321ff4079121b67c4bb17ae1f47eb5a04bc')throw Error('TypeScript file manifest changed');
const manifest=JSON.parse(manifestBytes),entry=path.resolve(process.env.TSC_ENTRY),packageRoot=path.dirname(path.dirname(entry));
if(entry!==path.join(packageRoot,'bin','tsc'))throw Error('TSC_ENTRY must be the TypeScript package bin/tsc');
const discovered=[];
function visit(dir,relative=''){
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  const name=relative?`${relative}/${item.name}`:item.name,full=path.join(dir,item.name);
  if(item.isSymbolicLink())throw Error(`Symlink not allowed in compiler: ${name}`);
  if(item.isDirectory())visit(full,name);else if(item.isFile())discovered.push(name);else throw Error(`Unexpected compiler entry: ${name}`);
 }
}
visit(packageRoot);
const expected=Object.keys(manifest.files).sort(),actual=discovered.sort();
if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('TypeScript package file set mismatch');
for(const name of expected)if(sha256(fs.readFileSync(path.join(packageRoot,name)))!==manifest.files[name])throw Error(`TypeScript file mismatch: ${name}`);
if(JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8')).version!=='6.0.3')throw Error('TypeScript version mismatch');
const target=fs.mkdtempSync(path.join(process.env.R7_TYPECHECK_BASE,'r7-graft-'));
fs.cpSync(path.join(__dirname,'type-stubs'),target,{recursive:true});
const rows=path.join(target,'client/rows');fs.mkdirSync(rows,{recursive:true});
for(const name of ['LineageGraft.tsx','lineage-plan.d.mts'])fs.copyFileSync(path.join(__dirname,'../candidate-src/client/rows',name),path.join(rows,name));
const result=cp.spawnSync(process.execPath,[entry,'-p',path.join(target,'tsconfig.json')],{encoding:'utf8',env:{HOME:target,TMPDIR:target,PATH:'/usr/bin:/bin'}});
if(result.error)throw result.error;
process.stdout.write(result.stdout);process.stderr.write(result.stderr);
console.log(`Stub diagnostic source retained at ${target}`);
process.exitCode=result.status??1;

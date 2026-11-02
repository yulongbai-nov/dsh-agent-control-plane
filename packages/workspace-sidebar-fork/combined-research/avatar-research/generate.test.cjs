// Synthetic temporary output only; never use a real profile or app path.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
test('creates new output exclusively and preserves an existing file',()=>{
 const project=process.env.R7_PROJECT;if(!project)throw Error('R7_PROJECT required');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r8-avatar-generator-'));
 try {
  const out=path.join(root,'assets.mjs');fs.writeFileSync(out,'SYNTHETIC_EXISTING');
  const env={PATH:'/usr/bin:/bin',R7_PROJECT:project,R7_OUTPUT:out};
  const refused=spawnSync(process.execPath,[path.join(__dirname,'generate.cjs')],{env,encoding:'utf8'});
  assert.notEqual(refused.status,0);assert.match(refused.stderr,/EEXIST/);assert.equal(fs.readFileSync(out,'utf8'),'SYNTHETIC_EXISTING');
  const fresh=path.join(root,'new-assets.mjs');const success=spawnSync(process.execPath,[path.join(__dirname,'generate.cjs')],{env:{...env,R7_OUTPUT:fresh},encoding:'utf8'});
  assert.equal(success.status,0,success.stderr);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(fresh)).digest('hex'),'8d00702195a6a9ae39adb92b6b517c84181bf232b8065d72b736ec2fdb4a6450');
 } finally {fs.rmSync(root,{recursive:true,force:true})}
})

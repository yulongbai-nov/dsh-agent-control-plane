// Refuse to execute a compiler unless every installed file matches the
// inventory produced from the lock-integrity-verified TypeScript tarball.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=function verifyTs6(input){
 const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
 const bytes=fs.readFileSync(path.join(__dirname,'typescript-6.0.3-files.json'));
 if(sha256(bytes)!=='b0e8e509a0906d501c032340bf172321ff4079121b67c4bb17ae1f47eb5a04bc')throw Error('TypeScript file manifest changed');
 const manifest=JSON.parse(bytes),entry=path.resolve(input),packageRoot=path.dirname(path.dirname(entry));
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
 const expected=Object.keys(manifest.files).sort();
 if(JSON.stringify(expected)!==JSON.stringify(discovered.sort()))throw Error('TypeScript package file set mismatch');
 for(const name of expected)if(sha256(fs.readFileSync(path.join(packageRoot,name)))!==manifest.files[name])throw Error(`TypeScript file mismatch: ${name}`);
 if(JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8')).version!=='6.0.3')throw Error('TypeScript version mismatch');
 return {entry,packageRoot};
};

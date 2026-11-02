// Read-only inventory of the pinned lockfile's workspace links. This includes
// dependency, devDependency and optionalDependency links, so it is an upper
// graph bound, not a claim that every importer is required for a client build.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
if(!process.env.LOCK_YAML_MODULE)throw Error('Set LOCK_YAML_MODULE to an explicitly reviewed js-yaml installation');
const yaml=require(process.env.LOCK_YAML_MODULE);
const bytes=fs.readFileSync(path.join(__dirname,'../upstream/build-metadata/pnpm-lock.yaml'));
const blob=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if(blob!=='d6df9aae42ba1c3a25e7a2b48f0eeb441d4d7411')throw Error('Unexpected upstream lockfile');
const lock=yaml.load(bytes.toString('utf8')),importers=lock.importers;
const queue=['packages/client/ui-workspace'],seen=new Set(),missing=new Set();
for(let index=0;index<queue.length;index++){
 const name=queue[index];if(seen.has(name))continue;seen.add(name);
 const importer=importers[name];if(!importer){missing.add(name);continue}
 for(const group of ['dependencies','devDependencies','optionalDependencies'])for(const item of Object.values(importer[group]||{})){
  const version=String(item.version||'');if(version.startsWith('link:'))queue.push(path.posix.normalize(path.posix.join(name,version.slice(5))));
 }
}
const root=importers['.'].devDependencies;
const pins=Object.fromEntries(['pnpm','typescript','tsdown','lightningcss','vitest'].map(name=>[name,root[name].version]));
console.log(JSON.stringify({gitBlob:blob,workspaceImporters:seen.size,missingImporters:[...missing],includesDevAndOptional:true,pins},null,2));
if(missing.size)process.exitCode=1;

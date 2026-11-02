// Independently parse pinned upstream JSONC references with the exact TS6
// compiler, without resolving projects or executing upstream scripts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const verifyTs6=require('./verify-ts6.cjs');
if(!process.env.TSC_ENTRY)throw Error('Set TSC_ENTRY to the verified TypeScript 6.0.3 package bin/tsc');
const {packageRoot}=verifyTs6(process.env.TSC_ENTRY),ts=require(path.join(packageRoot,'lib/typescript.js'));
const base=path.join(__dirname,'../upstream'),bytes=fs.readFileSync(path.join(base,'ts-project-graph.json'));
if(crypto.createHash('sha256').update(bytes).digest('hex')!=='6071524ff5b544da96441c0b54c13d2d2346e65e9618d7db47f545a911f49c01')throw Error('Pinned graph changed');
const graph=JSON.parse(bytes);let edgeCount=0;
for(const [file,content] of Object.entries(graph.docs)){
 const result=ts.parseConfigFileTextToJson(file,content);
 if(result.error)throw Error(`Could not parse ${file}: ${ts.flattenDiagnosticMessageText(result.error.messageText,' ')}`);
 const refs=(result.config.references||[]).map(entry=>{const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),entry.path));return target.endsWith('.json')?target:target+'/tsconfig.json'});
 if(JSON.stringify(refs)!==JSON.stringify(graph.edges[file]))throw Error(`Reference graph mismatch: ${file}`);
 edgeCount+=refs.length;
}
console.log(JSON.stringify({typescript:ts.version,configs:Object.keys(graph.docs).length,declaredReferences:edgeCount,parseErrors:0,mismatches:0}));

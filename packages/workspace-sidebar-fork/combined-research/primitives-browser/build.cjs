// Test-only adapter: tree-shake actual static-linked primitives bundle to
// WorkspaceBrowser's imports and compile its real CSS modules with lightningcss.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.R7_UPSTREAM;if(!root)throw Error('R7_UPSTREAM required');
const esbuild=require(path.join(root,'node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild'));
const {transform}=require(path.join(root,'node_modules/lightningcss'));
const workspace=fs.readFileSync(path.join(root,'packages/client/ui-workspace/lib/client.js'),'utf8');
const primitives=path.join(root,'packages/client/ui-primitives/lib/index.js');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
if(sha(workspace)!=='96112116563328207bb8c08e344a0ef2a9c7e3572a5f4730838c8ff2ae9e109a')throw Error('unexpected WorkspaceBrowser input');
if(sha(fs.readFileSync(primitives))!=='6e52c633c75e408d79d01754606aa7bd2f470eff720197862fb9f777076867a7')throw Error('unexpected ui-primitives input');
const names=[...new Set([...workspace.matchAll(/_deepseek_ai_dsh_client_ui_primitives\.([A-Za-z_$][\w$]*)/g)].map(x=>x[1]))].sort();
const entry=`export { ${names.join(',')} } from ${JSON.stringify(primitives)};`;
esbuild.build({stdin:{contents:entry,resolveDir:root,sourcefile:'r7-primitives-entry.js'},bundle:true,format:'cjs',platform:'browser',target:'es2022',external:['react','react/jsx-runtime','react-dom'],outfile:path.join(__dirname,'primitives.cjs'),metafile:true,plugins:[{name:'r7-real-css',setup(build){build.onLoad({filter:/\.css$/},args=>{const css=fs.readFileSync(args.path);const result=transform({filename:args.path,code:css,cssModules:args.path.endsWith('.module.css')?{pattern:'[hash]_[local]'}:false,minify:true});const map=Object.fromEntries(Object.entries(result.exports||{}).map(([key,v])=>[key,v.name]));const js=`if(!document.querySelector(${JSON.stringify('style[data-r7-css='+JSON.stringify(args.path)+']')})){const s=document.createElement('style');s.dataset.r7Css=${JSON.stringify(args.path)};s.textContent=${JSON.stringify(result.code.toString())};document.head.append(s)} export default ${JSON.stringify(map)};`;return {contents:js,loader:'js'}})}}]}).then(result=>{fs.writeFileSync(path.join(__dirname,'metafile.json'),JSON.stringify(result.metafile,null,2));console.log('exports',names.length,'bundle sha256',sha(fs.readFileSync(path.join(__dirname,'primitives.cjs'))))}).catch(e=>{console.error(e);process.exitCode=1});

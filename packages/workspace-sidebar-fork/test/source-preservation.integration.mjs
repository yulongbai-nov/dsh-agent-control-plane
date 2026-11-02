import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,base));
const text=async path=>(await read(path)).toString('utf8');
const section=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b)};

test('pinned upstream files match their full Git blob hashes and byte counts',async()=>{
 const manifest=JSON.parse(await text('upstream/manifest.json'));
 assert.equal(manifest.commit,'b830ec950faba0a46dda564be3e2d854afed94f1');
 for(const entry of manifest.files){const bytes=await read('upstream/src/'+entry.path);assert.equal(bytes.length,entry.size,entry.path);const hash=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');assert.equal(hash,entry.sha,entry.path)}
});
test('pinned build manifests and lockfile match upstream Git blobs',async()=>{
 const pins={
  'package.json':'21eecbf2da64c77dc3b29cf30b05f80789189fd1',
  'pnpm-workspace.yaml':'290650169a26c6e4df72b3035f2530f951df0748',
  'pnpm-lock.yaml':'d6df9aae42ba1c3a25e7a2b48f0eeb441d4d7411',
  'tsconfig.base.client.json':'6af2056c90b86afdf8cd229385e175d3f42b7eff',
  'tsconfig.base.json':'f083f9b35e49b446d0f53eca1443cd8a3bd7de61',
  'native/system/tsconfig.base.json':'a95ca64f6d4fb92deded2f335bac551d04d031bc',
  'packages/client/tsdown.client.ts':'90b26c196e6fc69acef39ccc4fad16fcaf1a0b5f',
  'packages/client/modules/src/client/manifest.ts':'1926d812a19f26f122d604559f7412222672766f',
  'packages/client/web/src/platform.ts':'31035552150a39ab8daa8218c7ac6f0478ed4152',
  'scripts/client-build-environment.ts':'6c616cff5b5bec5bf5f02765752b9eaf97b1979b',
  'scripts/experimental-package-policy.ts':'466acaed2a4c6ea83bb7f800aa307d8446ad1fe9',
  'scripts/bundle-input-isolation.ts':'e711d50cdd0828a704d7f5a63633f88f5e715553',
  'packages/client/ui-workspace/package.json':'0972e4505a4964f308dadbaabc3669dc0762ce15',
  'packages/client/ui-workspace/tsconfig.json':'dea11b7bd690ba5251014e5b8cc8472f6ca2e62a',
  'packages/client/ui-workspace/tsdown.config.ts':'7aa03cebc166f1d04de1f058a5e4a3db4e94c114',
 };
 for(const [path,expected] of Object.entries(pins)){const bytes=await read('upstream/build-metadata/'+path);const actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');assert.equal(actual,expected,path)}
});
test('pinned TypeScript reference graph retains its 127 upstream config blobs',async()=>{
 const graphBytes=await read('upstream/ts-project-graph.json'),shaBytes=await read('upstream/ts-project-shas.json');
 assert.equal(createHash('sha256').update(graphBytes).digest('hex'),'6071524ff5b544da96441c0b54c13d2d2346e65e9618d7db47f545a911f49c01');
 assert.equal(createHash('sha256').update(shaBytes).digest('hex'),'2999ffd15080629f53dd80b8cfdae00531c50f984f3ac8725e1219b34d0b8068');
 const graph=JSON.parse(graphBytes),shas=JSON.parse(shaBytes);
 assert.equal(graph.ref,'b830ec950faba0a46dda564be3e2d854afed94f1');assert.equal(Object.keys(graph.docs).length,127);assert.deepEqual(graph.err,{});
 for(const [name,content] of Object.entries(graph.docs)){const bytes=Buffer.from(content),actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');assert.equal(actual,shas[name],name)}
 const seen=new Set(),queue=[graph.root];for(let i=0;i<queue.length;i++){const config=queue[i];if(seen.has(config))continue;seen.add(config);assert.ok(Object.hasOwn(graph.docs,config),config);queue.push(...graph.edges[config])}
 assert.equal(seen.size,127);
});
test('native list derivation, search renderer and watermark algorithm are unchanged in the candidate source',async()=>{
 assert.deepEqual(await read('candidate-src/client/tree.ts'),await read('upstream/src/client/tree.ts'));
 const baseSource=await text('upstream/src/client/rows/WorkspaceBrowser.tsx'), candidate=await text('candidate-src/client/rows/WorkspaceBrowser.tsx');
 assert.equal(section(candidate,'function watermarkRows(','/** Keep controlled input'),section(baseSource,'function watermarkRows(','/** Keep controlled input'));
 assert.equal(section(candidate,'interface RemoteSearchState','export function WorkspaceBrowser('),section(baseSource,'interface RemoteSearchState','export function WorkspaceBrowser('));
 assert.match(candidate,/const visible = watermarkRows\(group\.sessions, watermark\)/);
 assert.match(candidate,/rowKeys\.push\(`session:\$\{node\.id\}`\)/);
});

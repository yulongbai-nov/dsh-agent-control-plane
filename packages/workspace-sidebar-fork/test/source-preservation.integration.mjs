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
  'packages/client/tsdown.client.ts':'90b26c196e6fc69acef39ccc4fad16fcaf1a0b5f',
  'packages/client/ui-workspace/package.json':'0972e4505a4964f308dadbaabc3669dc0762ce15',
  'packages/client/ui-workspace/tsconfig.json':'dea11b7bd690ba5251014e5b8cc8472f6ca2e62a',
  'packages/client/ui-workspace/tsdown.config.ts':'7aa03cebc166f1d04de1f058a5e4a3db4e94c114',
 };
 for(const [path,expected] of Object.entries(pins)){const bytes=await read('upstream/build-metadata/'+path);const actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');assert.equal(actual,expected,path)}
});
test('native list derivation, search renderer and watermark algorithm are unchanged in the candidate source',async()=>{
 assert.deepEqual(await read('candidate-src/client/tree.ts'),await read('upstream/src/client/tree.ts'));
 const baseSource=await text('upstream/src/client/rows/WorkspaceBrowser.tsx'), candidate=await text('candidate-src/client/rows/WorkspaceBrowser.tsx');
 assert.equal(section(candidate,'function watermarkRows(','/** Keep controlled input'),section(baseSource,'function watermarkRows(','/** Keep controlled input'));
 assert.equal(section(candidate,'interface RemoteSearchState','export function WorkspaceBrowser('),section(baseSource,'interface RemoteSearchState','export function WorkspaceBrowser('));
 assert.match(candidate,/const visible = watermarkRows\(group\.sessions, watermark\)/);
 assert.match(candidate,/rowKeys\.push\(`session:\$\{node\.id\}`\)/);
});

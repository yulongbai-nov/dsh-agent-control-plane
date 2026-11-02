// Static pinned-source characterization; never loads a profile or executes a review.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.R14_PUBLIC_SOURCE;
const files={
 'packages/boot/app-boot/src/profile.ts':'8e3c2fda0334e34b111d4c46f43859b3749b3444ed6a18c80cd06d8709f656ea',
 'packages/interaction/permission-presets/src/index.ts':'74cde09ca3f6cd08283ba66c384e1c06dae164f1b92ec90dd3884ab94e177c38',
 'packages/interaction/user-approval/src/index.ts':'6bba9feef5257063aa41d89ddd51c31a1a474b5920c256c65d5ec2857cff1ff6',
 'packages/sandbox/sandbox-policy/src/index.ts':'6fce58e5bf63475f761871389bbf01043fba859f22e44c805522c39afbff32d6',
 'packages/subagent/subagent-codex/src/run.ts':'b1630b87fd3ab253a77537f3b0a8301dd0317eaa40b604d62f862762f442b86f',
 'packages/subagent/subagent-codex/src/wire.ts':'f3efbdd78526264767331f5a06eb2c04c9d3fb715fbed713ddd77d6d513ccb9e',
 'packages/bundle/base/cordis.patch.yml':'a2cc57868a4d016609801e28781262515483dde29b41c2742d9a3b27a6f52f77',
 'packages/bundle/acp-app/cordis.patch.yml':'b2191971be86e253c4a53b27aaa5951a36b31721abad4fbd2e06352f2898cfa0',
 'packages/bundle/sdk-app/cordis.patch.yml':'f3b82cf41f2184d7099e393ce1d92ce109a1b76e490e57f7499a1803e540d238',
 'packages/bundle/headless/cordis.patch.yml':'f4d5f53f070089a7fc5209bd47c9ae4e85b99d042cbe76be88ab1ed63dfb8fc8',
 'packages/bundle/sdk-minimal/cordis.patch.yml':'464ea07c03d3639c2c387fa3a684f5d4001e7ca39f8257b361c604f19487af66',
 'packages/bundle/web-app/cordis.patch.yml':'cdceb423fc34c31ceb9c47ef2117a88eeda6fd9cc21f94d58cfd21e7c3e035de',
};
function read(file){assert.ok(root,'R14_PUBLIC_SOURCE must point to the reviewed public checkout');const bytes=fs.readFileSync(path.join(root,file));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),files[file],`unexpected source: ${file}`);return bytes.toString('utf8')}
test('pinned templates do not select optional Auto review bundle',()=>{
 const profile=read('packages/boot/app-boot/src/profile.ts');const templates=profile.split('export const PROFILE_TEMPLATES:')[1].split('const INSTALLATION_OWNED_PROFILE_TUPLES')[0];assert.doesNotMatch(templates,/auto-review/);assert.match(profile,/OPTIONAL_BUNDLES[\s\S]*@deepseek-ai\/dsh-experimental-auto-review/);
 for(const f of Object.keys(files).filter(x=>x.startsWith('packages/bundle/'))) assert.doesNotMatch(read(f),/dsh-experimental-auto-review/);
});
test('pinned base asks by default and auto is not a configured default preset',()=>{
 const base=read('packages/bundle/base/cordis.patch.yml'),presets=read('packages/interaction/permission-presets/src/index.ts');
 assert.match(base,/process\.env\.DSH_PERMISSION_MODE \?\? 'workspace-write'/);assert.match(base,/=== 'danger-full-access' \? 'never' : 'ask'/);
 assert.match(presets,/AUTO_PRESET = 'auto'/);assert.match(presets,/if \(AUTO_PRESET in this\.presets\)/);assert.match(presets,/Object\.hasOwn\(this\.presets, defaultPreset\)/);
 assert.match(read('packages/interaction/user-approval/src/index.ts'),/\.default\('ask'\)/);assert.match(read('packages/sandbox/sandbox-policy/src/index.ts'),/\.default\('read-only'\)/);
});
test('Codex provider default mode and explicit auto-review mode are distinct',()=>{
 assert.match(read('packages/subagent/subagent-codex/src/run.ts'),/DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode = 'never'/);
 assert.match(read('packages/subagent/subagent-codex/src/wire.ts'),/'approve-for-me':\s*\{[\s\S]*?approvalsReviewer: 'auto_review'/);
});
test('project research patches do not add Auto review or permission-default configuration',()=>{
 const base=path.resolve(__dirname,'..'), found=[];
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(entry.isFile()&&entry.name.endsWith('.patch'))for(const line of fs.readFileSync(p,'utf8').split('\n'))if(line.startsWith('+')&&!line.startsWith('+++')&&/auto.?review|approvalsReviewer|approval.?policy|defaultPreset|approve-for-me/i.test(line))found.push(path.relative(base,p));}}
 walk(base);assert.deepEqual(found,[]);
});

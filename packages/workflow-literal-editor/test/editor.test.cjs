'use strict';
const nodeTest=require('node:test');
const assert=require('node:assert/strict');
let parse;
try { ({parse}=require('acorn')); } catch {}
const test=parse?nodeTest:nodeTest.skip;
const {inspectScript,previewEdit}=require('../index.cjs');
const inspect=(script)=>inspectScript(script,{parse});
const preview=(script,target,field,value)=>previewEdit({script,target,field,value},{parse});
const script=`phase('Build');\nawait agent('original', { label:'first', provider:'codex', model:'base' });\nawait agent('next', {label:'second'});`;

test('inspects full source hash and immutable source-span target, with real layout',()=>{
  const info=inspect(script);
  assert.equal(info.ok,true);
  assert.match(info.sourceHash,/^[a-f0-9]{64}$/);
  assert.equal(info.targets.length,2);
  assert.equal(script.slice(info.targets[0].start,info.targets[0].end),`agent('original', { label:'first', provider:'codex', model:'base' })`);
  assert.equal(info.targets[0].sourceHash,info.sourceHash);
  assert.deepEqual(info.targets[0].fields,['prompt','provider','model','label']);
});

test('preview single literal change reparses and returns safe stable geometry and diff',()=>{
  const before=inspect(script);
  const result=preview(script,before.targets[0],'prompt','new\n"quote" ☃');
  assert.equal(result.ok,true);
  assert.match(result.script,/agent\("new\\n\\\"quote\\\" ☃"/);
  assert.equal(result.diff.before,"'original'");
  assert.equal(result.diff.after,'"new\\n\\\"quote\\\" ☃"');
  assert.deepEqual(result.diff.range,{start:script.indexOf("'original'"),end:script.indexOf("'original'")+10});
  assert.deepEqual(result.layout.nodes.map(({x,y})=>[x,y]),before.layout.nodes.map(({x,y})=>[x,y]));
  assert.equal(result.nodeMapping.length,2);
  assert.equal(result.nodeMapping[0].before,before.topology.nodes[0].id);
  assert.equal(result.nodeMapping[0].after,result.topology.nodes[0].id);
  assert.equal(inspect(result.script).ok,true);
  assert.equal(script.includes("'original'"),true);
});

test('all four allowed strings edit only an existing selected literal',()=>{
  for(const [field,value] of [['prompt','p'],['provider','new-provider'],['model','new-model'],['label','new-label']]){
    const info=inspect(script); const result=preview(script,info.targets[0],field,value);
    assert.equal(result.ok,true,`${field} ${JSON.stringify(result)}`);
    assert.equal(result.diff.before,({prompt:"'original'",provider:"'codex'",model:"'base'",label:"'first'"})[field]);
    assert.equal(result.diff.after,JSON.stringify(value));
  }
});

test('rejects stale fingerprint and forged source spans and node ids',()=>{
  const target=inspect(script).targets[0];
  for (const bad of [{...target,sourceHash:'f'.repeat(64)},{...target,start:target.start+1},{...target,end:target.end-1},{...target,nodeId:'forged'}]) {
    const result=preview(script,bad,'label','ok');
    assert.equal(result.ok,false); assert.ok(!Object.hasOwn(result,'script'));
  }
  assert.equal(preview(script+' ',target,'label','ok').ok,false);
});

test('value is JSON encoded and cannot inject executable script',()=>{
  const attack=`x'); globalThis.__editorExecuted = true; agent('evil`;
  delete globalThis.__editorExecuted;
  const result=preview(script,inspect(script).targets[0],'prompt',attack);
  assert.equal(result.ok,true);
  assert.equal(globalThis.__editorExecuted,undefined);
  assert.equal(result.topology.nodes.length,2);
  assert.equal(result.diff.after,JSON.stringify(attack));
});

test('refuses structural, dynamic, missing, unsupported and no-op edits',()=>{
  const target=inspect(script).targets[0];
  for(const [field,value] of [['phase','x'],['args',{}],['meta','x'],['prompt',2],['prompt','original'],['label',undefined]]) assert.equal(preview(script,target,field,value).ok,false);
  const short="await agent('only');";
  const found=inspect(short);
  assert.equal(preview(short,found.targets[0],'model','new').ok,false);
});

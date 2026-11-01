'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceObserver, attachSourceObserver, projectObservedWorkflow } = require('../index.cjs');
const { projectWorkflow } = require('../../workflow-board-projection/index.cjs');

const script = "await agent('hi', {label:'A'})";
function call(overrides = {}, resultOverrides = {}) {
  const abort = new AbortController();
  const exec = {
    name:'custom-workflow', callId:'call-1', rootCallId:'call-1',
    agent:{session:{id:'session-1'}}, signal:abort.signal,
    arguments:{script, meta:{name:'demo', description:'example', phases:[{title:'Build'}]}, args:{secret:'ignore'}, run_in_background:false},
    ...overrides,
  };
  const result = {isError:false, value:{kind:'foreground', runId:'run-1', agentsStarted:1, result:{secret:'ignore'}} ,...resultOverrides};
  return {exec,result,abort};
}
function make(maxEntries = 10) { return createSourceObserver({toolName:'custom-workflow',maxEntries}); }
function observe(observer, args = call()) { observer.observe(args.exec,args.result); }
function expected() { return {status:'unverified', toolName:'custom-workflow', sessionId:'session-1', toolCallId:'call-1', runId:'run-1', script, meta:{name:'demo',description:'example',phases:[{title:'Build'}]}}; }

test('captures only necessary detached pure data synchronously and never claims verification', () => {
  const observer = make();
  const fixture = call();
  observe(observer,fixture);
  fixture.exec.arguments.meta.phases[0].title = 'changed';
  fixture.exec.arguments.script = 'different';
  fixture.result.value.runId = 'changed';
  const candidate = observer.get('session-1','run-1');
  assert.deepEqual(candidate, expected());
  candidate.meta.phases[0].title = 'consumer changed';
  assert.deepEqual(observer.get('session-1','run-1'),expected());
  assert.equal(observer.get('session-1','changed'),undefined);
  assert.equal(JSON.stringify(observer.get('session-1','run-1')).includes('secret'),false);
});

test('requires exact explicitly configured tool name, never default name guessing', () => {
  for (const toolName of [undefined,'', '  ', 1]) assert.throws(() => createSourceObserver({toolName}), TypeError);
  const observer = make();
  observe(observer,call({name:'workflow'}));
  observe(observer,call({name:'other'}));
  assert.equal(observer.get('session-1','run-1'),undefined);
  observe(observer);
  assert.deepEqual(observer.get('session-1','run-1'),expected());
});

test('requires root dispatch, session, execution identity, live signal, and unambiguous success', () => {
  const invalid = [
    [{parent:Symbol('nested')}], [{rootCallId:'outer'}], [{rootCallId:undefined}], [{callId:''}],
    [{agent:undefined}], [{agent:{session:{}}}], [{agent:{session:{id:''}}}],
    [{signal:undefined}], [{signal:{}}], [{signal:{aborted:true}}],
    [{signal:{aborted:false}}],
    [{}, {isError:true}], [{}, {isError:undefined}], [{}, {value:undefined}],
    [{}, {value:{kind:'foreground'}}], [{}, {value:{kind:'foreground',runId:''}}],
    [{}, {value:{kind:'unknown',runId:'run-1'}}],
    [{}, {value:{kind:'foreground',runId:'run-1'}}],
    [{}, {value:{kind:'foreground',runId:'run-1',agentsStarted:-1,result:null}}],
    [{arguments:{script, meta:{name:'demo',description:'example'},run_in_background:true}}, {value:{kind:'background',runId:'run-1',jobId:'job'}}],
    [{}, {value:{kind:'background',runId:'run-1',jobId:'job'}}],
    [{arguments:{script, meta:{name:'demo',description:'example'},run_in_background:true}}],
  ];
  for (const [exec,result] of invalid) {
    const observer = make();
    observe(observer,call(exec,result));
    assert.equal(observer.get('session-1','run-1'),undefined,JSON.stringify([exec,result]));
  }
  const observer = make(), fixture = call();
  fixture.abort.abort(); observe(observer,fixture);
  assert.equal(observer.get('session-1','run-1'),undefined);
});

test('refuses malformed source and metadata instead of filling missing fields', () => {
  const badArgs = [
    undefined, null, {}, {script}, {script,meta:{}},
    {script,meta:{name:'x'}}, {script,meta:{name:2,description:'d'}},
    {script,meta:{name:'x',description:2}}, {script:4,meta:{name:'x',description:'d'}},
    {script,meta:{name:'x',description:'d',phases:'wrong'}},
    {script,meta:{name:'x',description:'d',phases:[null]}},
    {script,meta:{name:'x',description:'d',phases:[{title:2}]}},
    {script,meta:{name:'x',description:'d'},run_in_background:'false'},
  ];
  for (const args of badArgs) {
    const observer = make(); observe(observer,call({arguments:args}));
    assert.equal(observer.get('session-1','run-1'),undefined);
  }
  const observer = make();
  observe(observer,call({arguments:{script,meta:{name:'',description:''}}}));
  assert.deepEqual(observer.get('session-1','run-1').meta,{name:'',description:''});
});

test('identical duplicates are idempotent, conflicting call or run identities invalidate both sides', () => {
  const observer = make();
  observe(observer); observe(observer);
  assert.deepEqual(observer.get('session-1','run-1'),expected());
  observe(observer,call({arguments:{script:'DIFFERENT',meta:{name:'demo',description:'example'}}}));
  assert.equal(observer.get('session-1','run-1'),undefined);
  observe(observer);
  assert.equal(observer.get('session-1','run-1'),undefined);

  const observer2 = make(); observe(observer2);
  observe(observer2,call({}, {value:{kind:'foreground',runId:'run-2',agentsStarted:1,result:null}}));
  assert.equal(observer2.get('session-1','run-1'),undefined);
  assert.equal(observer2.get('session-1','run-2'),undefined);
  observe(observer2,call({callId:'call-2',rootCallId:'call-2'}));
  assert.equal(observer2.get('session-1','run-1'),undefined);
  observe(observer2,call({callId:'call-2',rootCallId:'call-2'}, {value:{kind:'foreground',runId:'run-3',agentsStarted:0,result:null}}));
  assert.equal(observer2.get('session-1','run-3'),undefined);

  const observer3 = make(); observe(observer3);
  observe(observer3,call({callId:'call-2',rootCallId:'call-2'}));
  assert.equal(observer3.get('session-1','run-1'),undefined);
  observe(observer3,call({callId:'call-2',rootCallId:'call-2'}, {value:{kind:'foreground',runId:'run-2',agentsStarted:0,result:null}}));
  assert.equal(observer3.get('session-1','run-2'),undefined);
});

test('a malformed or failed duplicate revokes and poisons the prior association', () => {
  const observer = make(); observe(observer);
  observe(observer,call({}, {isError:true,value:undefined}));
  assert.equal(observer.get('session-1','run-1'),undefined);
  observe(observer);
  assert.equal(observer.get('session-1','run-1'),undefined);
  const observer2 = make(); observe(observer2);
  observe(observer2,call({rootCallId:'not-root'}));
  assert.equal(observer2.get('session-1','run-1'),undefined);
});

test('session identifiers form independent namespaces', () => {
  const observer = make(); observe(observer);
  observe(observer,call({agent:{session:{id:'session-2'}}}));
  assert.deepEqual(observer.get('session-1','run-1'),expected());
  assert.equal(observer.get('session-2','run-1').sessionId,'session-2');
  assert.equal(observer.get('session-3','run-1'),undefined);
});

test('rejected inputs do not grow unbounded per-session state', () => {
  const observer = make(1);
  for (let i=0; i<1000; i++) observe(observer,call({agent:{session:{id:`invalid-${i}`}}},{isError:true,value:undefined}));
  observe(observer);
  assert.deepEqual(observer.get('session-1','run-1'),expected());
});

test('candidate excerpt and duplicate tracking stay inside total retained budget', () => {
  const observer = make();
  const oversized = {script:'s'.repeat(1_000_000),meta:{name:'x',description:'d'}};
  observe(observer,call({arguments:oversized}));
  assert.equal(observer.get('session-1','run-1'),undefined);
});

test('bulk payload and excessive arguments are dropped without retaining input', () => {
  const meta = {name:'ok', description:'d'};
  const badArgs = [
    {script:'x'.repeat(1_000_001),meta},
    {script:'x',meta:{...meta,description:'x'.repeat(1_000_001)}},
    {script:'x',meta:{...meta,phases:Array.from({length:1025},()=>({title:'x'}))}},
    {script:'x',meta:{...meta,phases:[{title:'x'.repeat(1_000_001)}]}},
  ];
  for (const arguments_ of badArgs) {
    const observer = make(); observe(observer,call({arguments:arguments_}));
    assert.equal(observer.get('session-1','run-1'),undefined);
  }
});

test('discard revokes all observations and permits a fresh process-lifetime window', () => {
  const observer = make(); observe(observer);
  observer.clear();
  assert.equal(observer.get('session-1','run-1'),undefined);
  observe(observer);
  assert.deepEqual(observer.get('session-1','run-1'),expected());
});

test('overflow fails closed without silently evicting conflict history', () => {
  const observer = make(1); observe(observer);
  observe(observer,call({callId:'c2',rootCallId:'c2'}, {value:{kind:'foreground',runId:'r2',agentsStarted:0,result:null}}));
  assert.equal(observer.get('session-1','run-1'),undefined);
  assert.equal(observer.get('session-1','r2'),undefined);
  observe(observer);
  assert.equal(observer.get('session-1','run-1'),undefined);
  observer.clear();
  observe(observer);
  assert.deepEqual(observer.get('session-1','run-1'),expected());
});

test('duplicate conflict detection also captures unretained metadata changes', () => {
  const observer = make(); observe(observer);
  const duplicate = call();
  duplicate.exec.arguments.meta.extra = 'different';
  observe(observer,duplicate);
  assert.equal(observer.get('session-1','run-1'),undefined);
});

test('serialization exceptions in duplicate candidates revoke the prior association', () => {
  const observer = make(); observe(observer);
  const duplicate = call();
  duplicate.exec.arguments.meta.extra = 1n;
  assert.doesNotThrow(() => observe(observer,duplicate));
  assert.equal(observer.get('session-1','run-1'),undefined);
});

test('observer catches thrown getters, registration adapter returns no result, and disposal stops capture', () => {
  let handler, disposed = false;
  const observer = make();
  const dispose = attachSourceObserver({on(event,callback) { assert.equal(event,'tools/result'); handler=callback; return () => {disposed=true;}; }},observer);
  const evil = call(); Object.defineProperty(evil.exec,'arguments',{get(){throw new Error('not safe')}});
  assert.doesNotThrow(() => handler(evil.exec,evil.result));
  assert.equal(handler(call().exec,call().result),undefined);
  assert.deepEqual(observer.get('session-1','run-1'),expected());
  dispose(); assert.equal(disposed,true);
  handler(call({callId:'x',rootCallId:'x'}).exec,call({}, {value:{kind:'foreground',runId:'other'}}).result);
  assert.equal(observer.get('session-1','other'),undefined);
});

test('conflicts raised while building the topology revoke the whole projection', () => {
  const observer = make(); observe(observer);
  let called = false;
  const board = projectObservedWorkflow({observer,sessionId:'session-1',runId:'run-1',events:[],
    extractTopology() { observe(observer,call({callId:'x',rootCallId:'x'})); return {nodes:[]}; },
    layoutTopology() {return {nodes:[],groups:[]};},
    projectWorkflow() {called=true;},
  });
  assert.equal(board,undefined);
  assert.equal(called,false);
});

test('projection adapter always passes unverified and parses only the captured script', () => {
  const observer = make(); observe(observer);
  let received;
  const board = projectObservedWorkflow({observer,sessionId:'session-1',runId:'run-1',events:[{type:'tool-workflow/agent-start',data:{runId:'run-1',seq:1,label:'A',childId:'child'}}],
    extractTopology(s,m) {received=[s,m]; return {complete:true,nodes:[{id:'node',kind:'agent',label:'A',phase:null,occurrence:'single'}]};},
    layoutTopology() {return {nodes:[],groups:[]};}, projectWorkflow});
  assert.deepEqual(received,[script,expected().meta]);
  assert.equal(board.sourceStatus,'unverified');
  assert.deepEqual(board.statusByNode,{});
  assert.equal(board.unmatched[0].reason,'source-unverified');
  assert.equal(projectObservedWorkflow({observer,sessionId:'unknown',runId:'run-1'}),undefined);
});

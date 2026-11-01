import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { checkAgentSpec } from '../index.mjs';

test('top-level and option accessors are rejected without invocation for every backend', () => {
  const backends = ['spawn', 'fork', 'codex', 'claude-code', 'acp', 'custom'];
  for (const backend of backends) for (const key of ['preset', 'overrides', 'provider', 'model', 'reasoningEffort', 'maxTokens', 'subagentDepth']) {
    let getterCalls = 0, setterCalls = 0;
    const target = {};
    Object.defineProperty(target, key, { enumerable: true, configurable: true,
      get() { getterCalls++; return key === 'overrides' ? {} : key === 'maxTokens' ? 1 : 'synthetic'; },
      set(_) { setterCalls++; },
    });
    const spec = key === 'preset' || key === 'overrides' ? target : { overrides: target };
    const result = checkAgentSpec(backend, spec);
    assert.equal(result.status, 'reject', `${backend}/${key}`);
    assert.equal(Object.hasOwn(result, 'approved'), false);
    assert.equal(getterCalls, 0);
    assert.equal(setterCalls, 0);
  }
});

test('a getter that would create a rejected promise is never invoked', () => {
  // Isolate strict unhandled rejections without weakening the parent process.
  const entry = new URL('../index.mjs', import.meta.url).href;
  const script = `
    import { checkAgentSpec } from ${JSON.stringify(entry)};
    let called=0; const spec={};
    Object.defineProperty(spec,'preset',{enumerable:true,get(){called++;return Promise.reject(Error('synthetic'));}});
    const r=checkAgentSpec('spawn',spec);
    if(r.status!=='reject'||Object.hasOwn(r,'approved')||called!==0) process.exitCode=2;
  `;
  const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, `stderr: ${child.stderr}`);
});

test('ordinary data input never invokes pre-existing inherited output setters', () => {
  // In a separate process so that modifying the prototype cannot affect the test runner.
  const entry = new URL('../index.mjs', import.meta.url).href;
  const script = `
    import { checkAgentSpec } from ${JSON.stringify(entry)};
    const fields=['provider','model','reasoningEffort','maxTokens','agentPreset','agentOptions'];
    let calls=0, code=0;
    const runs = [
      { backend:'spawn', spec:{preset:'fixture',overrides:{provider:'p',model:'m',reasoningEffort:'high',maxTokens:2}}, shape:'full' },
      { backend:'fork', spec:{overrides:{model:'m'}}, shape:'options' },
      { backend:'spawn', spec:{preset:'fixture'}, shape:'preset' },
      { backend:'spawn', spec:{}, shape:'empty' },
      { backend:'codex', spec:{}, shape:'empty' },
    ];
    for(const key of fields) Object.defineProperty(Object.prototype,key,{configurable:true,set(v){
      calls++; Object.defineProperty(this,'subagentDepth',{value:99,enumerable:true,configurable:true});
    }});
    try {
      for (const {backend,spec,shape} of runs) {
        const result=checkAgentSpec(backend,spec);
        const approved=result.approved;
        const preset=Object.getOwnPropertyDescriptor(approved,'agentPreset')?.value;
        const options=Object.getOwnPropertyDescriptor(approved,'agentOptions')?.value;
        if(result.status!=='unknown'||!approved||Object.hasOwn(approved,'subagentDepth')) code=2;
        if((shape==='full'||shape==='preset') ? preset!=='fixture' : Object.hasOwn(approved,'agentPreset')) code=3;
        if((shape==='full'||shape==='options') ? !options||Object.hasOwn(options,'subagentDepth')||options.model!=='m' : Object.hasOwn(approved,'agentOptions')) code=4;
        if(shape==='full' && (options.provider!=='p'||options.maxTokens!==2||options.reasoningEffort!=='high')) code=5;
      }
    } finally { for(const key of fields) Reflect.deleteProperty(Object.prototype,key); }
    if(calls!==0) code=6;
    if(code) process.exitCode=code;
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, `stderr: ${child.stderr}`);
});

test('inherited depth is not an own output property even though normal lookup sees it', () => {
  const entry = new URL('../index.mjs', import.meta.url).href;
  const script = `
    import { checkAgentSpec } from ${JSON.stringify(entry)};
    let calls=0, ok=false;
    Object.defineProperty(Object.prototype,'subagentDepth',{configurable:true,get(){calls++;return 99;}});
    try {
      const r=checkAgentSpec('spawn',{overrides:{model:'m'}});
      const opts=r.approved.agentOptions;
      ok=r.status==='unknown' && !Object.hasOwn(opts,'subagentDepth') && calls===0;
      const inherited=opts.subagentDepth;
      ok=ok && inherited===99 && calls===1;
    } finally {Reflect.deleteProperty(Object.prototype,'subagentDepth');}
    if(!ok) process.exitCode=2;
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, `stderr: ${child.stderr}`);
});

test('non-enumerable, nested exotic and cross-realm objects are rejected', () => {
  const nonenumPreset = Object.defineProperty({}, 'preset', { value: 'synthetic', enumerable: false });
  const nonenumModel = Object.defineProperty({}, 'model', { value: 'synthetic', enumerable: false });
  const crossRealm = vm.runInNewContext('({ preset: "synthetic" })');
  const crossRealmOptions = vm.runInNewContext('({ model: "synthetic" })');
  const argumentObject = (function () { return arguments; })();
  for (const spec of [nonenumPreset, { overrides: nonenumModel }, crossRealm, { overrides: crossRealmOptions }, argumentObject, { overrides: argumentObject }, { overrides: new Date() }, { overrides: new Map() }]) {
    const result = checkAgentSpec('spawn', spec);
    assert.equal(result.status, 'reject');
    assert.equal(Object.hasOwn(result, 'approved'), false);
  }
});

test('detected exotic objects are rejected even if their prototype is null', () => {
  for (const value of [new Date(), new Map(), new Set(), new WeakMap(), Promise.resolve('synthetic'), new Uint8Array(0), Object(1)]) {
    Object.setPrototypeOf(value, null);
    assert.equal(checkAgentSpec('spawn', value).status, 'reject');
    assert.equal(checkAgentSpec('spawn', { overrides: value }).status, 'reject');
  }
});

test('inherited descriptor setters cannot intercept snapshot or approved writes', () => {
  const entry = new URL('../index.mjs', import.meta.url).href;
  const script = `
    import { checkAgentSpec } from ${JSON.stringify(entry)};
    const fields=['value','enumerable','configurable','writable','get','set'];
    let calls=0;
    for(const key of fields) Object.defineProperty(Object.prototype,key,{__proto__:null,configurable:true,set(v){calls++;}});
    let ok=false;
    try {
      const result=checkAgentSpec('spawn',{preset:'fixture',overrides:{model:'m'}});
      ok=result.status==='unknown' && result.approved?.agentPreset==='fixture' && result.approved?.agentOptions?.model==='m' && calls===0;
    } finally { for(const key of fields) Reflect.deleteProperty(Object.prototype,key); }
    if(!ok) process.exitCode=2;
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, `stderr: ${child.stderr}`);
});

test('promise and thenable values are rejected without adoption or property access', () => {
  let traps = 0;
  const thenable = new Proxy({}, { get() { traps++; throw Error('unexpected'); } });
  const promise = Promise.resolve('synthetic');
  for (const value of [thenable, promise]) for (const spec of [{ preset: value }, { overrides: value }, { overrides: { model: value } }]) {
    const result = checkAgentSpec('spawn', spec);
    assert.equal(result.status, 'reject');
    assert.equal(Object.hasOwn(result, 'approved'), false);
    assert.equal(JSON.stringify(result).includes('unexpected'), false);
  }
  assert.equal(traps, 0);
});

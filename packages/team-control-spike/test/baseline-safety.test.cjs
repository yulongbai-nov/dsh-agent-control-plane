'use strict';
// Entirely synthetic guard tests. No app, GUI, profile or installed module reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadFixtureClasses } = require('./fixture-baseline.cjs');

const code = (expected) => (error) => error?.code === expected && error?.message === expected;

test('current native fixture refuses even apparently matching claims before any loader', async () => {
  for (const supplied of [undefined, null, { version: '0.2.1-rc.5' }, { version: 'wrong' }, { version: 'changed' }, { version: '0.2.1-rc.5', sha256: '0'.repeat(64), verified: true }]) {
    let calls = 0;
    await assert.rejects(loadFixtureClasses({ evidence: supplied, loader() { calls++; return {}; } }), code('NATIVE_BASELINE_UNVERIFIED'));
    assert.equal(calls, 0);
  }
});

test('all four historical native cases explicitly skip, never pass', () => {
  // Never execute an unchecked entry: inspect local source before spawning.
  const testEntry = path.resolve(__dirname, 'rc5.baseline.cjs');
  const text = fs.readFileSync(testEntry, 'utf8');
  assert.doesNotMatch(text, /\/Applications\/|app\.asar|\bimport\s*\(/);
  const child = spawnSync(process.execPath, ['--test', testEntry], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', TEAM_BASELINE_VERIFIED: 'true', TEAM_EXPECTED_SHA256: '0'.repeat(64) },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /tests 4/);
  assert.match(child.stdout, /pass 0/);
  assert.match(child.stdout, /skipped 4/);
  assert.match(child.stdout, /NATIVE_BASELINE_UNVERIFIED/);
  assert.doesNotMatch(child.stdout + child.stderr, /ERR_MODULE_NOT_FOUND|\/Applications\//);
});

test('original fixture path refuses native classes before any injected loader or reads', () => {
  const testEntry = path.resolve(__dirname, 'rc5.baseline.cjs');
  const text = fs.readFileSync(testEntry, 'utf8');
  assert.doesNotMatch(text, /\/Applications\/|app\.asar|\bimport\s*\(/);
  const wrapper = `
    const fs=require('node:fs');
    let reads=0,loads=0;
    for (const key of ['readFileSync','openSync','readFile','open']) {
      const original=fs[key];
      fs[key]=function(path,...rest){
        if(String(path).includes('app.asar')||String(path).includes('/Applications/')) {reads++;throw Error('FORBIDDEN_READ');}
        return original.call(this,path,...rest);
      };
    }
    const Module=require('node:module');
    const originalLoad=Module._load;
    Module._load=function(id,...rest){
      if(String(id).includes('app.asar')||String(id).includes('@deepseek-ai/')) {loads++;throw Error('FORBIDDEN_LOAD');}
      return originalLoad.call(this,id,...rest);
    };
    const {fixture}=require(${JSON.stringify(testEntry)});
    fixture({evidence:{version:'0.2.1-rc.5',verified:true},loader(){loads++;}}).then(
      ()=>{process.exitCode=2;},
      error=>{if(error.code!=='NATIVE_BASELINE_UNVERIFIED'||reads!==0||loads!==0)process.exitCode=3;}
    );
  `;
  const child = spawnSync(process.execPath, ['--input-type=commonjs', '-e', wrapper], { encoding: 'utf8' });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.doesNotMatch(child.stdout + child.stderr, /FORBIDDEN_READ|FORBIDDEN_LOAD|ERR_MODULE_NOT_FOUND|\/Applications\//);
});

test('historical native test code cannot reference installation or dynamic import', () => {
  const text = fs.readFileSync(path.join(__dirname, 'rc5.baseline.cjs'), 'utf8');
  assert.doesNotMatch(text, /\/Applications\/|app\.asar|\bimport\s*\(/);
});

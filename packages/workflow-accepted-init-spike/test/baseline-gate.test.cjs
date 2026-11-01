'use strict';
// Pure synthetic I/O and loader spies: no installed app module is imported.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  loadPinned, desktopPath, packagePath, enginePath, expectedEngineSha256,
} = require('./baseline-gate.cjs');

const desktop = () => ({ version: '0.2.1-rc.5', dshBuildCommit: 'd4db512a969fccf0c5cc7ec8fe38e9c1d27af916', dshBuildDirty: false });
const pkg = () => ({ version: '0.2.1-rc.5', license: 'MIT' });
const bytes = Buffer.from('synthetic engine bytes, intentionally not the pinned hash');
assert.notEqual(crypto.createHash('sha256').update(bytes).digest('hex'), expectedEngineSha256);

function harness({ desktopValue = desktop(), packageValue = pkg(), engineValue = bytes, throwAt, malformedAt } = {}) {
  const calls = [];
  const reads = [];
  const readFileSync = (path, encoding) => {
    reads.push(path);
    if (path === throwAt) throw Object.assign(new Error('synthetic read failure'), { code: 'EIO' });
    if (path === malformedAt) return '{';
    if (path === desktopPath) { assert.equal(encoding, 'utf8'); return JSON.stringify(desktopValue); }
    if (path === packagePath) { assert.equal(encoding, 'utf8'); return JSON.stringify(packageValue); }
    if (path === enginePath) { assert.equal(encoding, undefined); return engineValue; }
    throw new Error(`unexpected synthetic path: ${path}`);
  };
  const load = async (path) => { calls.push(path); return { path }; };
  return { readFileSync, load, calls, reads };
}

const mismatchCases = [
  ['Desktop version', { desktopValue: { ...desktop(), version: '0.2.1-rc.6' } }, /Desktop version/],
  ['Desktop commit', { desktopValue: { ...desktop(), dshBuildCommit: 'not-the-build' } }, /Desktop build commit/],
  ['Desktop dirty flag', { desktopValue: { ...desktop(), dshBuildDirty: true } }, /Desktop dirty flag/],
  ['workflow-ptc version', { packageValue: { ...pkg(), version: '0.2.1-rc.6' } }, /workflow-ptc version/],
  ['workflow-ptc license', { packageValue: { ...pkg(), license: 'other' } }, /workflow-ptc license/],
  ['engine SHA-256', {}, /engine SHA-256/],
  ['malformed Desktop metadata', { malformedAt: desktopPath }, SyntaxError],
  ['malformed package metadata', { malformedAt: packagePath }, SyntaxError],
  ['unreadable Desktop metadata', { throwAt: desktopPath }, /synthetic read failure/],
  ['unreadable package metadata', { throwAt: packagePath }, /synthetic read failure/],
  ['unreadable engine source', { throwAt: enginePath }, /synthetic read failure/],
];

for (const [name, options, expectedError] of mismatchCases) {
  test(`${name} blocks all app-module loader calls`, async () => {
    const fake = harness(options);
    await assert.rejects(loadPinned({ readFileSync: fake.readFileSync, load: fake.load }), expectedError);
    assert.deepEqual(fake.calls, []);
  });
}

test('hash mismatch reads all pinned inputs but does not invoke either loader', async () => {
  const fake = harness();
  await assert.rejects(loadPinned({ readFileSync: fake.readFileSync, load: fake.load }), /engine SHA-256/);
  assert.deepEqual(fake.reads, [desktopPath, packagePath, enginePath]);
  assert.deepEqual(fake.calls, []);
});

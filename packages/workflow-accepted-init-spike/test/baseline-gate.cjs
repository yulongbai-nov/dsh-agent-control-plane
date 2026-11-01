'use strict';
// Tests-only gate: read installed metadata and source before importing any app module.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const packages = `${root}/dsh/node_modules/@deepseek-ai/`;
const enginePath = `${packages}dsh-workflow-ptc/lib/index.js`;
const desktopPath = `${root}/package.json`;
const packagePath = `${packages}dsh-workflow-ptc/package.json`;
const expectedEngineSha256 = 'c7718bc30bcdfb33de38e2011096f2edddccba536b8891c4e6ea456a41fbf19c';
const engineModule = 'dsh-workflow-ptc/lib/index.js';
const cordisModule = 'cordis/lib/index.js';

function verifyBaseline(readFileSync = fs.readFileSync) {
  // Synchronous and fail-closed: parsing, missing files, bad fields, hashing or
  // digest mismatches throw before the caller has invoked any app-module loader.
  const desktop = JSON.parse(readFileSync(desktopPath, 'utf8'));
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  assert.equal(desktop.version, '0.2.1-rc.5', 'unexpected Desktop version');
  assert.equal(desktop.dshBuildCommit, 'd4db512a969fccf0c5cc7ec8fe38e9c1d27af916', 'unexpected Desktop build commit');
  assert.equal(desktop.dshBuildDirty, false, 'unexpected Desktop dirty flag');
  assert.equal(pkg.version, '0.2.1-rc.5', 'unexpected workflow-ptc version');
  assert.equal(pkg.license, 'MIT', 'unexpected workflow-ptc license');
  const actualHash = crypto.createHash('sha256').update(readFileSync(enginePath)).digest('hex');
  assert.equal(actualHash, expectedEngineSha256, 'unexpected workflow-ptc engine SHA-256');
}

// Both parameters are injectable solely for synthetic tests. Ordinary callers
// use the pinned-path reader and native dynamic ESM import defaults; the strict
// verifier itself cannot be bypassed through an injectable callback.
async function loadPinned({ readFileSync, load = (path) => import(pathToFileURL(packages + path).href) } = {}) {
  verifyBaseline(readFileSync);
  return Promise.all([load(cordisModule), load(engineModule)]);
}

module.exports = { loadPinned, desktopPath, packagePath, enginePath, expectedEngineSha256 };

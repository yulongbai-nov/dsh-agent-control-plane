import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readiness, evidenceSummary } from '../preflight.mjs';

function runCli(contents) {
  const injectedReader = `import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    fs.promises.readFile = async () => ${contents};
    syncBuiltinESMExports();`;
  return spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(injectedReader)}`,
    fileURLToPath(new URL('../preflight.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 5000 });
}

function assertCliFailure(result, code, message) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, code, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout + result.stderr, message);
}

test('actual CLI rejects missing or invalid desktopVersion instead of succeeding silently', () => {
  for (const value of [{}, { version: '0.2.1-rc.5' }, { desktopVersion: null }, { desktopVersion: false }, { desktopVersion: 5 }, { desktopVersion: {} }, { desktopVersion: '' }, { desktopVersion: '   ' }, null, []]) {
    assertCliFailure(runCli(JSON.stringify(JSON.stringify(value))), 2, /元数据|版本/u);
  }
});

test('actual CLI reports unsupported string, bad JSON and reader errors as failures', () => {
  assertCliFailure(runCli(JSON.stringify('{"desktopVersion":"0.2.1-rc.6"}')), 2, /0\.2\.1-rc\.6/u);
  assertCliFailure(runCli(JSON.stringify('{')), 2, /元数据/u);
  assertCliFailure(runCli('Promise.reject(Object.assign(new Error("read failed"), { code: "EACCES" }))'), 2, /EACCES/u);
});

test('actual CLI with exact rc.5 reports blockers and exits 1', () => {
  const result = runCli(JSON.stringify('{"desktopVersion":"0.2.1-rc.5"}'));
  assertCliFailure(result, 1, /未解决：.*Keychain/u);
  assert.match(result.stdout, /未启动服务或浏览器/u);
});

test('design-only preflight refuses to authorize launch', () => {
  const status = readiness();
  assert.equal(status.ready, false);
  assert.ok(status.blockers.some((item) => /Keychain/u.test(item)));
  assert.ok(status.blockers.some((item) => /本地端口/u.test(item)));
  assert.ok(status.blockers.some((item) => /用户文件/u.test(item)));
  assert.ok(status.blockers.some((item) => /生命周期/u.test(item)));
});

test('only actual requested boundaries are described, never unverified success', () => {
  const summary = evidenceSummary();
  assert.equal(summary.appVersion, '0.2.1-rc.5');
  assert.equal(summary.serverStarted, false);
  assert.equal(summary.browserStarted, false);
  assert.equal(summary.profileCreated, false);
  assert.equal(summary.e2eValidated, false);
  assert.equal(summary.sandboxProvesIsolation, false);
});

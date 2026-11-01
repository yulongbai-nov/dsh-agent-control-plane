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
  assertCliFailure(runCli('Promise.reject(Object.assign(new Error("read failed"), { code: "EACCES" }))'), 2, /无法读取安装版元数据/u);
});

test('bounded ASCII version grammar preserves mismatch failure', () => {
  for (const desktopVersion of ['0.2.1', '1.2.3-rc.6', `0.2.1-${'a'.repeat(58)}`]) {
    const result = runCli(JSON.stringify(JSON.stringify({ desktopVersion })));
    assertCliFailure(result, 2, /预期 0\.2\.1-rc\.5/u);
    assert.match(result.stdout, /未解决：/u);
  }
});

test('invalid version text cannot inject output or terminal controls', () => {
  for (const desktopVersion of [
    '0.2.1-rc.5\n安全就绪：可以启动服务和浏览器',
    '0.2.1-rc.5\r安全就绪',
    '0.2.1-rc.5\n',
    '0.2.1-rc.5\r',
    '0.2.1-rc.5\u001b[2J安全就绪',
    '0.2.1-rc.5\u2028安全就绪',
    '0.2.1-rc.5\u2028',
    '0.2.1-rc.5\u0000x',
    `0.2.1-${'a'.repeat(59)}`,
    `0.2.1-rc.${'9'.repeat(1000)}`,
    ' 0.2.1-rc.5',
    'v0.2.1-rc.5',
    '0.2.1-rc.5/../../leak',
  ]) {
    const result = runCli(JSON.stringify(JSON.stringify({ desktopVersion })));
    assertCliFailure(result, 2, /元数据|版本/u);
    assert.doesNotMatch(result.stdout + result.stderr, /安全就绪|\u001b|\u2028|\u0000|\.\.\/\.\.\/leak/u);
    assert.ok((result.stdout + result.stderr).length < 1000, 'output remains bounded');
  }
});

test('reader errors never print untrusted messages, codes or invoke error accessors', () => {
  for (const contents of [
    'Promise.reject(Object.assign(new Error("SECRET_MESSAGE\\n安全就绪"), { code: "SECRET_CODE\\u001b[2J" }))',
    'Promise.reject(Object.defineProperties({}, { code: { get() { throw new Error("SECRET_GETTER"); } }, message: { get() { throw new Error("SECRET_GETTER"); } } }))',
    'Promise.reject(null)',
  ]) {
    const result = runCli(contents);
    assertCliFailure(result, 2, /无法读取安装版元数据/u);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET_|安全就绪|\u001b|TypeError/u);
  }
});

test('actual CLI with exact rc.5 reports blockers and exits 1', () => {
  const result = runCli(JSON.stringify('{"desktopVersion":"0.2.1-rc.5"}'));
  assertCliFailure(result, 1, /未解决：.*Keychain/u);
  assert.match(result.stdout, /未启动服务或浏览器/u);
  assert.match(result.stdout, /未解决：.*OS 级.*loopback.*监听.*0\.0\.0\.0.*负向/u);
  assert.match(result.stdout, /未解决：.*fixture/u);
});

test('design-only preflight refuses to authorize launch', () => {
  const status = readiness();
  assert.equal(status.ready, false);
  status.ready = true;
  status.blockers.length = 0;
  assert.equal(readiness().ready, false);
  assert.ok(readiness().blockers.length > 0);
  const current = readiness();
  assert.ok(current.blockers.some((item) => /Keychain/u.test(item)));
  assert.ok(current.blockers.some((item) => /本地端口/u.test(item)));
  assert.ok(current.blockers.some((item) => /用户文件/u.test(item)));
  assert.ok(current.blockers.some((item) => /生命周期/u.test(item)));
  assert.ok(current.blockers.some((item) => /fixture/u.test(item)));
  assert.ok(current.blockers.some((item) => /OS 级/u.test(item) && /loopback/u.test(item) && /监听/u.test(item)));
  assert.ok(current.blockers.some((item) => /0\.0\.0\.0/u.test(item) && /负向/u.test(item)));
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness, evidenceSummary } from '../preflight.mjs';

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

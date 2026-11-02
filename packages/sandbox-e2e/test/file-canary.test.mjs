import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFileProbe, probeSyntheticFiles } from '../file-canary.mjs';

test('a narrow successful file canary never claims E2E readiness', () => {
  assert.deepEqual(classifyFileProbe(0, { positive:'allowed', negative:'denied', symlink:'denied', child:'denied' }),
    { result:'PASS_NARROW_FILE_PROBE', e2eReady:false });
});

test('all positive and negative observations are required', () => {
  const good = { positive:'allowed', negative:'denied', symlink:'denied', child:'denied' };
  for (const field of Object.keys(good)) {
    assert.equal(classifyFileProbe(0, { ...good, [field]:'error' }).result, 'BLOCKED_OR_FAILED');
    assert.equal(classifyFileProbe(0, { ...good, [field]:'allowed' }).result, field === 'positive' ? 'PASS_NARROW_FILE_PROBE' : 'BLOCKED_OR_FAILED');
  }
  assert.equal(classifyFileProbe(71, good).result, 'BLOCKED_OR_FAILED');
  assert.equal(classifyFileProbe(null, null).result, 'BLOCKED_OR_FAILED');
});

test('missing or relative fixture base fails before creating files', async () => {
  await assert.rejects(probeSyntheticFiles(), /absolute/);
  await assert.rejects(probeSyntheticFiles('relative'), /absolute/);
});

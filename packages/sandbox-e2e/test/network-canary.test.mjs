import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { networkCanary } from '../network-canary.mjs';

function fakeServers(results, observed) {
  return () => {
    const result = results.shift();
    const server = new EventEmitter();
    server.listen = (options, callback) => {
      observed.push(options);
      queueMicrotask(() => result === 'ok' ? callback() : server.emit('error', { code: result }));
    };
    server.close = callback => { observed.push('closed'); callback?.(); };
    return server;
  };
}

test('requires loopback success and explicit permission denial for wildcard', async () => {
  const observed = [];
  const result = await networkCanary({ createServer: fakeServers(['ok', 'EACCES'], observed) });
  assert.deepEqual(result, { status: 'PASS', loopback: 'allowed', wildcard: 'denied', ready: false });
  assert.deepEqual(observed, [
    { host: '127.0.0.1', port: 0, exclusive: true }, 'closed',
    { host: '0.0.0.0', port: 0, exclusive: true },
  ]);
});

test('wildcard allowed fails, and all other errors are blocked', async () => {
  for (const [responses, status, wildcard] of [
    [['ok', 'ok'], 'FAIL', 'allowed'],
    [['ok', 'EADDRINUSE'], 'BLOCKED', 'unknown'],
    [['EPERM'], 'BLOCKED', 'not-run'],
  ]) {
    const observed = [];
    const result = await networkCanary({ createServer: fakeServers(responses, observed) });
    assert.equal(result.status, status);
    assert.equal(result.wildcard, wildcard);
    assert.equal(result.ready, false);
    if (wildcard === 'not-run') assert.equal(observed.length, 1);
  }
});

test('unresponsive or throwing server cannot produce a pass', async () => {
  assert.equal((await networkCanary({ createServer() { throw Error('failure'); } })).status, 'BLOCKED');
  const result = await networkCanary({ createServer() { return { once() {}, listen() {}, close() {} }; }, timeoutMs: 5 });
  assert.equal(result.status, 'BLOCKED');
});

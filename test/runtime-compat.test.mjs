import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectRuntime, readAsarEntry } from '../scripts/runtime-compat.mjs';

function asar(entries) {
  const files = {};
  const bodies = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const parts = name.split('/');
    let current = files;
    for (const part of parts.slice(0, -1)) {
      current[part] ??= { files: {} };
      current = current[part].files;
    }
    const body = Buffer.from(text);
    current[parts.at(-1)] = { size: body.length, offset: String(offset) };
    offset += body.length;
    bodies.push(body);
  }
  const header = Buffer.from(JSON.stringify({ files }));
  // Model Electron's nested Pickle envelopes, including 4-byte alignment.
  const padding = (4 - (header.length % 4)) % 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + header.length + padding, 4);
  prefix.writeUInt32LE(4 + header.length + padding, 8);
  prefix.writeUInt32LE(header.length, 12);
  return Buffer.concat([prefix, header, Buffer.alloc(padding), ...bodies]);
}

const pkg = (name, version = '0.2.1-rc.5') => [
  `dsh/node_modules/@deepseek-ai/${name}/package.json`,
  JSON.stringify({ name: `@deepseek-ai/${name}`, version }),
];

function compatibleEntries() {
  return Object.fromEntries([
    ...['dsh-client-ui-sidebar', 'dsh-client-ui-subagent', 'dsh-client-ui-workspace', 'dsh-session-title', 'dsh-workflow-ptc'].map(name => pkg(name)),
    ['dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js', 'sidebar.panellist sidebar.workspaces'],
    ['dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js', 'subagentCatalog useSessions'],
    ['dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js', 'sidebar.workspaces useSessions'],
    ['dsh/node_modules/@deepseek-ai/dsh-session-title/lib/index.js', 'sessionTitle register(provider) onUserMessage'],
    ['dsh/node_modules/@deepseek-ai/dsh-workflow-ptc/lib/index.js', 'agent-start parallel pipeline'],
  ]);
}

test('reads one archive entry without exposing other content', () => {
  const buffer = asar({ 'a/b.txt': 'hello', 'a/c.txt': 'world' });
  assert.equal(readAsarEntry(buffer, 'a/b.txt'), 'hello');
  assert.throws(() => readAsarEntry(buffer, 'a/missing'), /missing/i);
  assert.throws(() => readAsarEntry(buffer, '../a/b.txt'), /path/i);
});

test('rejects malformed headers and out-of-range entries', () => {
  assert.throws(() => readAsarEntry(Buffer.alloc(4), 'x'), /archive|header/i);
  const buffer = asar({ x: 'hello' }).subarray(0, -3);
  assert.throws(() => readAsarEntry(buffer, 'x'), /bounds|range/i);
});

test('rejects malformed nested pickle envelopes and unaligned sizes', () => {
  const original = asar({ x: 'hello' });
  for (const [offset, value] of [[0, 0], [8, 0], [4, original.readUInt32LE(4) - 1]]) {
    const buffer = Buffer.from(original);
    buffer.writeUInt32LE(value, offset);
    assert.throws(() => readAsarEntry(buffer, 'x'), /archive|header|pickle/i, `corrupt word at ${offset}`);
  }
});

test('rejects contradictory link entries even with file metadata', () => {
  const header = Buffer.from(JSON.stringify({ files: { x: { link: 'missing', size: 5, offset: '0' } } }));
  const padding = (4 - (header.length % 4)) % 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + header.length + padding, 4);
  prefix.writeUInt32LE(4 + header.length + padding, 8);
  prefix.writeUInt32LE(header.length, 12);
  const buffer = Buffer.concat([prefix, header, Buffer.alloc(padding), Buffer.from('hello')]);
  assert.throws(() => readAsarEntry(buffer, 'x'), /unsupported/i);
});

test('rejects invalid JSON and unsupported or unsafe offsets and sizes', () => {
  const buffer = asar({ x: 'hello' });
  const invalidJson = Buffer.from(buffer);
  invalidJson[16] = 0x21;
  assert.throws(() => readAsarEntry(invalidJson, 'x'), /JSON/i);

  function withNode(node) {
    const header = Buffer.from(JSON.stringify({ files: { x: node } }));
    const padding = (4 - header.length % 4) % 4;
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(8 + header.length + padding, 4);
    prefix.writeUInt32LE(4 + header.length + padding, 8);
    prefix.writeUInt32LE(header.length, 12);
    return Buffer.concat([prefix, header, Buffer.alloc(padding), Buffer.from('hello')]);
  }
  for (const node of [
    { offset: '-1', size: 5 }, { offset: 'nope', size: 5 },
    { offset: '9999999999999999999', size: 5 }, { offset: '0', size: -1 },
    { offset: '0', size: 9999 }, { offset: '0', size: 5, unpacked: true },
    { files: {} },
  ]) assert.throws(() => readAsarEntry(withNode(node), 'x'), /unsupported|range/i);
});

test('CLI reports usage and missing archive errors with explicit exit codes', () => {
  const script = fileURLToPath(new URL('../scripts/runtime-compat.mjs', import.meta.url));
  const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage/i);
  const missing = spawnSync(process.execPath, [script, '/this-file-does-not-exist.app.asar'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /compatibility check failed/i);
});

test('compatible installed versions and required seams pass', () => {
  const report = inspectRuntime(asar(compatibleEntries()));
  assert.equal(report.ok, true);
  assert.equal(report.expectedVersion, '0.2.1-rc.5');
  assert.equal(report.packages.length, 5);
  assert.ok(report.packages.every(item => item.ok));
});

test('version drift or missing seam fails closed and identifies the package', () => {
  const entries = compatibleEntries();
  entries[pkg('dsh-session-title')[0]] = pkg('dsh-session-title', '0.2.1-rc.6')[1];
  entries['dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js'] = 'subagentCatalog';
  const report = inspectRuntime(asar(entries));
  assert.equal(report.ok, false);
  assert.equal(report.packages.find(item => item.name === 'dsh-session-title').ok, false);
  assert.equal(report.packages.find(item => item.name === 'dsh-client-ui-subagent').ok, false);
});

test('missing package is reported rather than aborting all checks', () => {
  const entries = compatibleEntries();
  delete entries[pkg('dsh-workflow-ptc')[0]];
  const report = inspectRuntime(asar(entries));
  assert.equal(report.ok, false);
  assert.match(report.packages.find(item => item.name === 'dsh-workflow-ptc').error, /missing/i);
  assert.equal(report.packages.find(item => item.name === 'dsh-session-title').ok, true);
});

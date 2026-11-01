#!/usr/bin/env node
/**
 * Read-only compatibility probes for the exact packaged DSH runtime.
 * These marker checks identify obvious drift, not behavioral compatibility.
 * An archive is never modified and no profile is inspected or changed.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const EXPECTED_VERSION = '0.2.1-rc.5';
const ROOT = 'dsh/node_modules/@deepseek-ai/';
const PACKAGES = [
  { name: 'dsh-client-ui-sidebar', file: 'lib/client.js', markers: ['sidebar.panellist', 'sidebar.workspaces'] },
  { name: 'dsh-client-ui-subagent', file: 'lib/client.js', markers: ['subagentCatalog', 'useSessions'] },
  { name: 'dsh-client-ui-workspace', file: 'lib/client.js', markers: ['sidebar.workspaces', 'useSessions'] },
  { name: 'dsh-session-title', file: 'lib/index.js', markers: ['sessionTitle', 'register(provider)', 'onUserMessage'] },
  { name: 'dsh-workflow-ptc', file: 'lib/index.js', markers: ['agent-start', 'parallel', 'pipeline'] },
];

export function readAsarEntry(buffer, path) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) throw new Error('Invalid archive header');
  if (typeof path !== 'string' || !path || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid archive entry path');
  }
  const outerPayloadSize = buffer.readUInt32LE(0);
  const outerSize = buffer.readUInt32LE(4);
  const innerPayloadSize = buffer.readUInt32LE(8);
  const headerSize = buffer.readUInt32LE(12);
  const base = 8 + outerSize;
  const alignedHeaderSize = Math.ceil(headerSize / 4) * 4;
  if (outerPayloadSize !== 4 || outerSize !== innerPayloadSize + 4 ||
      innerPayloadSize !== alignedHeaderSize + 4 || outerSize % 4 !== 0 || base > buffer.length) {
    throw new Error('Invalid archive header bounds or Pickle envelope');
  }
  let header;
  try { header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString('utf8')); }
  catch { throw new Error('Invalid archive header JSON'); }
  let node = header;
  for (const part of path.split('/')) {
    if (!node?.files || !Object.hasOwn(node.files, part)) throw new Error(`Missing archive entry: ${path}`);
    node = node.files[part];
  }
  if (node?.files || node?.unpacked || Object.hasOwn(node, 'link') || !/^\d+$/.test(node?.offset ?? '') || !Number.isSafeInteger(node?.size) || node.size < 0) {
    throw new Error(`Unsupported archive entry: ${path}`);
  }
  const offset = Number(node.offset);
  if (!Number.isSafeInteger(offset) || offset > buffer.length - base || node.size > buffer.length - base - offset) {
    throw new Error(`Archive entry out of range: ${path}`);
  }
  return buffer.subarray(base + offset, base + offset + node.size).toString('utf8');
}

export function inspectRuntime(buffer, expectedVersion = EXPECTED_VERSION) {
  const packages = PACKAGES.map(({ name, file, markers }) => {
    try {
      const manifest = JSON.parse(readAsarEntry(buffer, `${ROOT}${name}/package.json`));
      const source = readAsarEntry(buffer, `${ROOT}${name}/${file}`);
      const missingMarkers = markers.filter(marker => !source.includes(marker));
      const versionMatches = manifest.version === expectedVersion;
      return { name, version: manifest.version, versionMatches, missingMarkers, ok: versionMatches && missingMarkers.length === 0 };
    } catch (error) {
      return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { ok: packages.every(item => item.ok), expectedVersion, packages };
}

async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) {
    console.error('Usage: node scripts/runtime-compat.mjs /absolute/path/to/app.asar');
    process.exitCode = 2;
    return;
  }
  try {
    const report = inspectRuntime(await readFile(path));
    console.log(JSON.stringify({ archive: path, ...report, disclaimer: 'Marker check only; run integration and GUI tests separately.' }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Compatibility check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

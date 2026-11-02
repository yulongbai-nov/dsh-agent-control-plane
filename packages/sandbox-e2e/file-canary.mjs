// Narrow synthetic file-access probe. This does not authorize DSH or GUI launch.
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const script = String.raw`
const fs = require('node:fs');
const cp = require('node:child_process');
const [allowed, blocked, link] = process.argv.slice(1);
function read(path) { try { fs.readFileSync(path); return 'allowed'; } catch (e) { return e && (e.code === 'EPERM' || e.code === 'EACCES') ? 'denied' : 'error'; } }
const child = cp.spawnSync(process.execPath, ['-e', 'try{require("node:fs").readFileSync(process.argv[1]);process.stdout.write("allowed")}catch(e){process.stdout.write(e && (e.code === "EPERM" || e.code === "EACCES") ? "denied" : "error")}', blocked], {encoding:'utf8', timeout:3000});
process.stdout.write(JSON.stringify({positive:read(allowed), negative:read(blocked), symlink:read(link), child:child.status === 0 ? child.stdout : 'error'}));`;

export function classifyFileProbe(status, checks) {
  const expected = { positive: 'allowed', negative: 'denied', symlink: 'denied', child: 'denied' };
  const passed = status === 0 && checks !== null && typeof checks === 'object' &&
    Object.keys(expected).every(k => Object.hasOwn(checks, k) && checks[k] === expected[k]);
  return { result: passed ? 'PASS_NARROW_FILE_PROBE' : 'BLOCKED_OR_FAILED', e2eReady: false };
}

/** Creates and retains only new synthetic fixtures under baseDirectory. */
export async function probeSyntheticFiles(baseDirectory) {
  if (typeof baseDirectory !== 'string' || !baseDirectory.startsWith('/')) throw new Error('absolute test directory required');
  const base = await realpath(baseDirectory);
  const dir = await mkdtemp(join(base, 'file-canary-'));
  const allowed = join(dir, 'positive.txt');
  const privateDir = join(dir, 'blocked');
  const blocked = join(privateDir, 'synthetic.txt');
  const link = join(dir, 'synthetic-link');
  await mkdir(privateDir, { mode: 0o700 });
  await writeFile(allowed, 'synthetic positive', { mode: 0o600 });
  await writeFile(blocked, 'synthetic negative', { mode: 0o600 });
  await symlink(blocked, link);
  // The generated path is JSON quoted; no untrusted shell or SBPL source is evaluated.
  const policy = `(version 1) (allow default) (deny file-read* file-write* (subpath ${JSON.stringify(privateDir)}))`;
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, '-e', script, allowed, blocked, link], {
    encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', HOME: dir, TMPDIR: dir },
  });
  let checks;
  try { checks = JSON.parse(result.stdout); } catch { checks = null; }
  return { ...classifyFileProbe(result.status, checks), fixtureDirectory: dir, checks, exitCode: result.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await probeSyntheticFiles(process.argv[2]);
    console.log(JSON.stringify(report));
    process.exitCode = report.result === 'PASS_NARROW_FILE_PROBE' ? 0 : 1;
  }
  catch { console.error('Synthetic file probe could not be prepared.'); process.exitCode = 2; }
}

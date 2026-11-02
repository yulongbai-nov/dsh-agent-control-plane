import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, realpath, symlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// One small private fixture is shared by tests in this file. It contains only
// synthetic copies, is intentionally retained, and is never automatically deleted.
let fixturePromise;
function buildFixture() { return fixturePromise ??= createFixture(); }
async function createFixture() {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, 'dsh-session-tree-test-'));
  assert.equal(await realpath(root), root);
  assert.equal(dirname(root), parent);
  assert.ok(basename(root).startsWith('dsh-session-tree-test-'));
  console.log(`Retained synthetic build fixture (no automatic deletion): ${root}`);
  const dir = join(root, 'package');
  await mkdir(dir);
  await mkdir(join(dir, 'avatars'));
  for (const name of ['build.mjs', 'client.template.js', 'lineage.mjs']) {
    await copyFile(new URL(`../${name}`, import.meta.url), join(dir, name));
  }
  // Builder reads bytes without decoding; six tiny synthetic files suffice.
  for (const name of ['lead', 'research', 'code', 'write', 'data', 'qa']) {
    await writeFile(join(dir, 'avatars', `${name}.png`), Buffer.from(name));
  }
  const template = await readFile(join(dir, 'client.template.js'), 'utf8');
  const lineage = await readFile(join(dir, 'lineage.mjs'), 'utf8');
  const { renderClient } = await import('../build.mjs');
  const images = Object.fromEntries(['lead', 'research', 'code', 'write', 'data', 'qa'].map(name => [name, `data:image/png;base64,${Buffer.from(name).toString('base64')}`]));
  const generated = renderClient(template, images, lineage);
  return { root, dir, template, lineage, generated };
}

function runBuild(entry, options = [], nodeOptions = []) {
  const result = spawnSync(process.execPath, [...nodeOptions, entry, ...options], { encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `unexpected signal: ${result.signal}`);
  return result;
}

const SENTINEL = 'synthetic previously saved output; do not overwrite\n';

test('production build and check reject invalid scripts without overwriting output', async () => {
  const { dir, template, lineage, generated } = await buildFixture();
  const target = join(dir, 'client.js'), templateFile = join(dir, 'client.template.js');
  const lineageFile = join(dir, 'lineage.mjs'), build = join(dir, 'build.mjs');
  const badInputs = [
    { name: 'lineage before export', template, lineage: 'export const accidental=1;\n' + lineage },
    { name: 'lineage before import', template, lineage: 'import x from "not-installed";\n' + lineage },
    { name: 'lineage syntax', template, lineage: 'function broken( {\n' + lineage },
    { name: 'lineage extra final export', template, lineage: lineage + '\nexport const extra=1;' },
    { name: 'template export', template: 'export const extra=1;\n' + template, lineage },
    { name: 'template import', template: 'import x from "not-installed";\n' + template, lineage },
    { name: 'template syntax', template: 'function broken( {\n' + template, lineage },
    { name: 'syntax hidden in template placeholder', template: template.replace('/* LINEAGE_SOURCE */ null /* END_LINEAGE_SOURCE */', '/* LINEAGE_SOURCE */ function !!! /* END_LINEAGE_SOURCE */'), lineage },
  ];
  for (const bad of badInputs) {
    await writeFile(templateFile, bad.template);
    await writeFile(lineageFile, bad.lineage);
    for (const args of [[], ['--check']]) {
      await writeFile(target, SENTINEL);
      const result = runBuild(build, args);
      assert.notEqual(result.status, 0, `${bad.name} ${args.join(' ')}`);
      assert.equal(await readFile(target, 'utf8'), SENTINEL, `${bad.name} must not change output`);
    }
  }
  await writeFile(templateFile, template);
  await writeFile(lineageFile, lineage);
  await writeFile(target, SENTINEL);
  assert.notEqual(runBuild(build, ['--check']).status, 0, 'stale check must fail');
  assert.equal(await readFile(target, 'utf8'), SENTINEL);
  assert.equal(runBuild(build).status, 0, 'valid production build');
  assert.equal(await readFile(target, 'utf8'), generated);
  assert.equal(runBuild(build, ['--check']).status, 0, 'fresh valid check');
  // Syntactically valid source must be parsed only; this would throw if run.
  await writeFile(templateFile, 'throw Error("synthetic script executed");\n' + template);
  assert.equal(runBuild(build).status, 0);
  assert.equal(runBuild(build, ['--check']).status, 0);
});

test('symlinked build CLI rejects stale output and updates it without side effects on import', async t => {
  const { root, dir, template, lineage, generated } = await buildFixture();
  const target = join(dir, 'client.js'), templateFile = join(dir, 'client.template.js');
  const lineageFile = join(dir, 'lineage.mjs'), realBuild = join(dir, 'build.mjs');
  // Valid source is not executed by either the default or symlinked CLI.
  await writeFile(templateFile, template);
  await writeFile(lineageFile, lineage);
  const buildSource = await readFile(realBuild, 'utf8');
  const mainGate = 'import.meta.main';
  assert.match(buildSource, /if\s*\(import\.meta\.main/);
  const noMetaMain = buildSource.replaceAll(mainGate, 'undefined');
  assert.notEqual(noMetaMain, buildSource);
  const fallbackBuild = join(dir, 'build-no-meta-main.mjs');
  await writeFile(fallbackBuild, noMetaMain);
  const dirAlias = join(root, 'package-alias'), fileAlias = join(root, 'build-alias.mjs');
  const fallbackAlias = join(root, 'fallback-alias.mjs');
  try {
    await symlink(dir, dirAlias, 'dir');
    await symlink(realBuild, fileAlias, 'file');
    await symlink(fallbackBuild, fallbackAlias, 'file');
  } catch (error) {
    if (process.platform === 'win32' && (error?.code === 'EPERM' || error?.code === 'EACCES')) {
      t.skip('platform requires symlink creation permission');return;
    }
    throw error;
  }
  const entries = [
    ['symlink directory', join(dirAlias, 'build.mjs')], ['symlink file', fileAlias],
    ['without meta.main', fallbackBuild], ['fallback directory symlink', join(dirAlias, 'build-no-meta-main.mjs')],
    ['fallback file symlink', fallbackAlias],
  ];
  for (const [label, entry] of entries) {
    for (const nodeOptions of [[], ['--preserve-symlinks-main']]) {
      await writeFile(target, SENTINEL);
      assert.notEqual(runBuild(entry, ['--check'], nodeOptions).status, 0, `${label} stale check ${nodeOptions}`);
      assert.equal(await readFile(target, 'utf8'), SENTINEL);
      assert.equal(runBuild(entry, [], nodeOptions).status, 0, `${label} build ${nodeOptions}`);
      assert.equal(await readFile(target, 'utf8'), generated);
      assert.equal(runBuild(entry, ['--check'], nodeOptions).status, 0, `${label} fresh check ${nodeOptions}`);
    }
  }
  await writeFile(target, SENTINEL);
  // Corrupt only this synthetic fixture's inputs to expose any accidental build
  // reads while still allowing module import; no files are deleted.
  await writeFile(templateFile, 'not a valid template');
  await writeFile(lineageFile, 'not valid lineage');
  for (const entry of [realBuild, ...entries.map(([, path]) => path)]) {
    // Trap calls from the imported module, after the JS module loader has loaded
    // the builtins. Source-code reads by Node's loader are necessarily allowed.
    const script = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      for (const name of ['readFile', 'writeFile', 'realpath']) fs.promises[name] = async () => { throw Error('unexpected build I/O'); };
      syncBuiltinESMExports();
      await import(${JSON.stringify(pathToFileURL(entry).href)});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');assert.equal(result.stderr, '');
    assert.equal(await readFile(target, 'utf8'), SENTINEL, 'import must not write generated output');
  }
  // On Node 24.0/24.1 a real entry script may import the fallback module.
  const importer = join(dir, 'synthetic-importer.mjs');
  await writeFile(importer, 'await import("./build-no-meta-main.mjs");\n');
  const importerResult = runBuild(importer);
  assert.equal(importerResult.status, 0, importerResult.stderr);
  assert.equal(await readFile(target, 'utf8'), SENTINEL, 'fallback import must not write');
  for (const arg of ['missing-entry.mjs', '-', '[eval]']) {
    const script = `await import(${JSON.stringify(pathToFileURL(fallbackBuild).href)});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(root, arg)], { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `import with ${arg}: ${result.stderr}`);
    assert.equal(await readFile(target, 'utf8'), SENTINEL);
  }
  // A path-resolution error other than a non-path/missing argv must not be
  // disguised as a successful no-op when determining an entry.
  const syncFailure = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    fs.realpathSync = () => { const e = Error('synthetic denied'); e.code = 'EACCES'; throw e; };
    syncBuiltinESMExports();
    await import(${JSON.stringify(pathToFileURL(fallbackBuild).href)});
  `;
  const denied = spawnSync(process.execPath, ['--input-type=module', '-e', syncFailure, join(root, 'not-entry')], { encoding: 'utf8' });
  if (denied.error) throw denied.error;
  assert.notEqual(denied.status, 0);assert.match(denied.stderr, /synthetic denied/);
  assert.equal(await readFile(target, 'utf8'), SENTINEL);
});

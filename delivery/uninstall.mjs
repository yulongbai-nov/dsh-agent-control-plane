#!/usr/bin/env node
/**
 * Roll one profile back to the snapshot recorded by delivery/install.mjs.
 *
 *   node delivery/uninstall.mjs --profile e2e
 *   node delivery/uninstall.mjs --profile desktop --yes
 *
 * Restores package.json / cordis.patch.yml from the backup, prunes installed
 * packages with `dsh plugin <profile> install`, and verifies the control-plane
 * bundles are gone. The backup directory is kept for audit.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = homedir()
// Honour an isolated $DSH_HOME (CI / throwaway test profiles).
const DSH_HOME_ROOT = process.env.DSH_HOME || join(HOME, '.dsh')
const APP_DSH = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const DSH = process.env.DSH_BIN || (existsSync(APP_DSH) ? APP_DSH : 'dsh')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const PROFILE = flag('--profile', 'desktop')
const YES = argv.includes('--yes') || argv.includes('-y')
const fail = (message) => {
  console.error(`[uninstall] ERROR: ${message}`)
  process.exit(1)
}
const profileDir = join(DSH_HOME_ROOT, 'profiles', PROFILE)
const receiptPath = join(profileDir, '.control-plane-install.json')
if (!existsSync(receiptPath)) fail(`no install receipt at ${receiptPath}; nothing to roll back automatically`)
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
if (!existsSync(receipt.backup)) fail(`snapshot missing: ${receipt.backup}`)
if (PROFILE === 'desktop' && !YES) {
  console.log('[uninstall] desktop is the live profile. Re-run with --yes after quitting the DSH app.')
  process.exit(0)
}

for (const file of ['package.json', 'cordis.patch.yml']) {
  const source = join(receipt.backup, file)
  if (existsSync(source)) {
    copyFileSync(source, join(profileDir, file))
    console.log(`[uninstall] restored ${file} from ${receipt.backup}`)
  }
}

const result = spawnSync(DSH, ['plugin', '--profile', PROFILE, 'install'], { stdio: 'inherit' })
if (result.status !== 0) fail(`dsh plugin install exited with ${result.status} (snapshot already restored)`)

const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
const bundles = pkg.dsh?.profile?.bundles ?? []
const leftovers = receipt.components.map((c) => c.name).filter((name) => bundles.includes(name))
if (leftovers.length) fail(`bundles still present after rollback: ${leftovers.join(', ')}`)
console.log(`[uninstall] control-plane bundles removed; snapshot kept at ${receipt.backup}`)
if (PROFILE === 'desktop') console.log('[uninstall] restart the DSH app to unload the plugins.')

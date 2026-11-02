#!/usr/bin/env node
/**
 * Install the DSH agent control plane bundle set into one profile, with a
 * configuration snapshot taken first and a receipt written afterwards.
 *
 *   node delivery/install.mjs --profile e2e           # test / non-Electron profile
 *   node delivery/install.mjs --profile desktop --yes # needs the app quit first
 *   node delivery/install.mjs --profile e2e --dry-run # print the plan only
 *
 * Components (R = requirement covered):
 *   dsh-control-plane-session-tree        R7 sidebar tree + R8 six task avatars
 *   dsh-agent-teams-model-override        R1/R3/R5/R6 team model per member + nesting
 *   dsh-workflow-map                      R10/R11 workflow map panel
 *   dsh-local-telemetry                   R18/R15 local telemetry store
 *   dshmarket                             R13 plugin market / install-upgrade UX
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = homedir()
const DSH = process.env.DSH_BIN || '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const PROFILE = flag('--profile', 'desktop')
const DRY = argv.includes('--dry-run')
const YES = argv.includes('--yes') || argv.includes('-y')
const fail = (message) => {
  console.error(`[install] ERROR: ${message}`)
  process.exit(1)
}

const COMPONENTS = [
  { name: 'dsh-control-plane-session-tree', spec: `file:${join(REPO, 'third_party/dsh-session-tree')}`, covers: 'R7/R8' },
  {
    name: 'dsh-agent-teams-model-override',
    spec: 'github:funk80rus/dsh-agent-teams-model-override#1bbe0891710264a5bc4b517045f785204e6a652c',
    covers: 'R1/R3/R5/R6',
  },
  { name: 'dsh-workflow-map', spec: 'dsh-workflow-map@1.0.0', covers: 'R10/R11' },
  { name: 'dsh-local-telemetry', spec: 'dsh-local-telemetry@0.2.1', covers: 'R18/R15' },
  { name: 'dshmarket', spec: 'dshmarket@1.73.8', covers: 'R13' },
]

const profileDir = join(HOME, '.dsh/profiles', PROFILE)
if (!existsSync(join(profileDir, 'package.json'))) {
  if (PROFILE === 'desktop') fail(`desktop profile not found at ${profileDir}`)
  const web = join(HOME, '.dsh/profiles/web')
  if (!existsSync(web)) fail(`no web profile template at ${web}`)
  console.log(`[install] creating profile "${PROFILE}" from the web template`)
  cpSync(web, profileDir, { recursive: true })
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = join(profileDir, '.control-plane-backup', stamp)
mkdirSync(backupDir, { recursive: true })
const backedUp = []
for (const file of ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml']) {
  const source = join(profileDir, file)
  if (!existsSync(source)) continue
  cpSync(source, join(backupDir, file))
  backedUp.push(file)
}
writeFileSync(
  join(backupDir, 'README.txt'),
  `Control-plane install snapshot ${stamp}\nprofile: ${PROFILE}\nfiles: ${backedUp.join(', ')}\n` +
    `rollback: node delivery/uninstall.mjs --profile ${PROFILE}\n`,
)
console.log(`[install] profile snapshot: ${backupDir}`)

const specs = COMPONENTS.map((c) => c.spec)
if (DRY) {
  console.log('[install] dry run; would execute:')
  console.log(`  ${DSH} plugin --profile ${PROFILE} add ${specs.join(' ')}`)
  process.exit(0)
}
if (PROFILE === 'desktop' && !YES) {
  console.log('[install] desktop is the live profile. Re-run with --yes after quitting the DSH app.')
  process.exit(0)
}

// One pnpm invocation installs every component (the CLI forwards args verbatim).
const result = spawnSync(DSH, ['plugin', '--profile', PROFILE, 'add', ...specs], { stdio: 'inherit' })
if (result.status !== 0) fail(`dsh plugin add exited with ${result.status}`)

// The CLI records bundles in most cases; make the list explicit and idempotent.
const pkgPath = join(profileDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.dsh ??= {}
pkg.dsh.profile ??= {}
pkg.dsh.profile.bundles ??= []
const added = []
for (const component of COMPONENTS) {
  if (!pkg.dsh.profile.bundles.includes(component.name)) {
    pkg.dsh.profile.bundles.push(component.name)
    added.push(component.name)
  }
}
if (added.length) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`[install] bundles registered: ${added.join(', ') || '(already present)'}`)

const missingDeps = COMPONENTS.filter((c) => !pkg.dependencies?.[c.name]).map((c) => c.name)
if (missingDeps.length) fail(`profile package.json is missing dependencies: ${missingDeps.join(', ')}`)

writeFileSync(
  join(profileDir, '.control-plane-install.json'),
  JSON.stringify(
    {
      installedAt: new Date().toISOString(),
      profile: PROFILE,
      backup: backupDir,
      components: COMPONENTS.map((c) => ({ name: c.name, spec: c.spec, covers: c.covers })),
    },
    null,
    2,
  ) + '\n',
)

console.log('[install] done. Components (requirement coverage):')
for (const component of COMPONENTS) console.log(`  - ${component.name}  ${component.covers}`)
if (PROFILE === 'desktop') console.log('[install] restart the DSH app to load the bundles.')
else console.log(`[install] boot with: dsh --profile ${PROFILE} --host 127.0.0.1 --port 0 --no-open`)

import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One-command real-GUI E2E runner for the DSH agent control plane.
 *
 *   node e2e/run-e2e.mjs                 # offline suite (zero model requests)
 *   node e2e/run-e2e.mjs --reset-state   # wipe the isolated test state first
 *   node e2e/run-e2e.mjs --real-model    # add the two gated real-model tests
 *
 * It boots the real installed DSH with a non-desktop profile. That profile
 * shares ~/.dsh (so the user's credentials are used) but the profile patch
 * redirects sessions/storages/workspaces/telemetry into $DSH_E2E_ROOT/state, so
 * the user's own sessions and the desktop GUI are never touched.
 */

const DSH = process.env.DSH_E2E_DSH_BIN || '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
const HOME = homedir()
// CI / npm-CLI mode: point the whole run at an isolated $DSH_HOME instead of ~/.dsh.
const DSH_HOME_ROOT = process.env.DSH_E2E_HOME || join(HOME, '.dsh')
const HARNESS = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HARNESS, '..')
const PROFILE = process.env.DSH_E2E_PROFILE || 'e2e'
const ROOT = process.env.DSH_E2E_ROOT || '/tmp/dsh-e2e'
const STATE = join(ROOT, 'state')
const WORKSPACE = join(STATE, 'documents/deepseek-harness/default-workspace')
const ARTIFACTS = join(ROOT, 'artifacts')
const args = process.argv.slice(2)
const RESET_STATE = args.includes('--reset-state')
const REAL_MODEL = args.includes('--real-model')
const NO_INSTALL = args.includes('--no-install')
const MOCK_MODEL = args.includes('--mock-model')
const MOCK_SIMPLE = args.includes('--mock-model-simple')
// Default mock layer: the official Messages mock server (production protocol).
const MOCK_PROVIDER = MOCK_MODEL ? (MOCK_SIMPLE ? 'simple' : 'official') : null

const requiredBundles = [
  'dsh-control-plane-session-tree',
  'dsh-agent-teams-model-override',
  'dsh-workflow-map',
  'dsh-local-telemetry',
  'dshmarket',
]

const log = (...a) => console.log('[run-e2e]', ...a)
const sanitize = (s) => String(s ?? '').replace(/token=[A-Za-z0-9_-]+/g, 'token=<redacted>')
const sha256 = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null)
const listSessionsDirs = () =>
  existsSync(join(DSH_HOME_ROOT, 'sessions')) ? readdirSync(join(DSH_HOME_ROOT, 'sessions')).sort() : []
const tcpOpen = (port) =>
  new Promise((resolveConn) => {
    const s = connect({ host: '127.0.0.1', port }, () => {
      s.destroy()
      resolveConn(true)
    })
    s.on('error', () => resolveConn(false))
    s.setTimeout(500, () => {
      s.destroy()
      resolveConn(false)
    })
  })
const grep = (pattern) =>
  new Promise((resolveGrep) => {
    const p = spawn('pgrep', ['-fl', pattern])
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('exit', () => resolveGrep(out.trim().split('\n').filter(Boolean)))
  })
const runCommand = (cmd, argv, opts = {}) =>
  new Promise((resolveRun) => {
    const p = spawn(cmd, argv, { stdio: 'inherit', ...opts })
    p.on('exit', (code) => resolveRun(code ?? 1))
  })

if (PROFILE === 'desktop') throw new Error('refusing to run E2E against the desktop profile')

const profileDir = join(DSH_HOME_ROOT, 'profiles', PROFILE)

// --- profile bootstrap: copy web template, apply isolation patch, install bundles ---
if (!NO_INSTALL) {
  if (!existsSync(join(profileDir, 'package.json'))) {
    // Official bootstrap for both local and CI: the CLI lays down its shipped template.
    // Never copy the user's own web profile (it may carry personal customisations).
    const code = await runCommand(DSH, ['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'], {
      stdio: 'ignore',
      env: { ...process.env, DSH_HOME: DSH_HOME_ROOT, DSH_BIN: DSH },
    })
    if (code !== 0) throw new Error('failed to create the profile from the shipped web template')
    log(`created profile "${PROFILE}" from the shipped web template`)
  }
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const marker = '# --- dsh-agent-control-plane e2e isolation ---'
  const current = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  if (!current.includes(marker)) {
    const isolationPatch = readFileSync(join(HARNESS, 'profile-patch.yml'), 'utf8').replaceAll('/tmp/dsh-e2e', ROOT)
    // A fresh shipped-template profile ships an inline empty array `[]`; entries
    // cannot be appended after it, so replace it in that case.
    const emptyArray = current.trim() === '' || current.trim().endsWith('[]')
    if (existsSync(patchPath) && !emptyArray) appendFileSync(patchPath, '\n' + isolationPatch)
    else writeFileSync(patchPath, isolationPatch)
    log('applied the e2e isolation patch (state redirected under', STATE + ')')
  }
  const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const bundles = pkg?.dsh?.profile?.bundles ?? []
  const missing = requiredBundles.filter((name) => !bundles.includes(name))
  if (missing.length) {
    log('installing control-plane bundles:', missing.join(', '))
    const code = await runCommand(process.execPath, [join(REPO, 'delivery/install.mjs'), '--profile', PROFILE, '--yes'], {
      env: { ...process.env, DSH_HOME: DSH_HOME_ROOT, DSH_BIN: DSH },
    })
    if (code !== 0) throw new Error('delivery install failed')
  }
}

if (!existsSync(join(profileDir, 'package.json'))) throw new Error(`test profile missing: ${profileDir}`)

const HOST_PATTERN = `(dsh-desktop-host/lib/cli.js|@deepseek-ai/dsh/lib/bin.js) (${PROFILE}|--profile ${PROFILE})`
const leftover = await grep(HOST_PATTERN)
if (leftover.length) throw new Error(`another ${PROFILE} instance is already running:\n${leftover.join('\n')}`)

const runId = new Date().toISOString().replace(/[:.]/g, '-')
const runDir = join(ROOT, 'runs', `run-${runId}`)
const shotDir = join(runDir, 'screenshots')
mkdirSync(shotDir, { recursive: true })
mkdirSync(ARTIFACTS, { recursive: true })

if (RESET_STATE) {
  log('resetting test state:', STATE)
  rmSync(STATE, { recursive: true, force: true })
}
mkdirSync(WORKSPACE, { recursive: true })

// --- optional deterministic model layer -------------------------------------------------
// Default: the OFFICIAL Messages mock server (@deepseek-ai/dsh-llm-mock-server), pointed at
// by $DEEPSEEK_BASE_URL so the production DeepSeek adapter speaks its real protocol.
// `--mock-model-simple` keeps our dependency-free OpenAI-compatible mock via a pi-ai route.
let mockProvider = null
let mockPatchPath = null
let originalProfilePatch = null
let mockRecordPath = null
let officialMockUrl = null
if (MOCK_PROVIDER) {
  mockRecordPath = join(STATE, 'mock-provider', 'requests.jsonl')
  mkdirSync(dirname(mockRecordPath), { recursive: true })
  const script =
    MOCK_PROVIDER === 'official'
      ? join(HARNESS, 'mock-provider/official-server.mjs')
      : join(HARNESS, 'mock-provider/server.mjs')
  mockProvider = spawn(process.execPath, [script, '--record', mockRecordPath], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const mockUrl = await new Promise((resolveMock, rejectMock) => {
    let out = ''
    const timer = setTimeout(() => rejectMock(new Error('mock provider start timeout')), 15_000)
    mockProvider.stdout.on('data', (d) => {
      out += d
      const m = out.match(/MOCK_PROVIDER_URL=(\S+)/)
      if (m) {
        clearTimeout(timer)
        resolveMock(m[1])
      }
    })
  })
  log(`mock model provider (${MOCK_PROVIDER}):`, mockUrl)
  if (MOCK_PROVIDER === 'simple') {
    mockPatchPath = join(profileDir, 'cordis.patch.yml')
    originalProfilePatch = readFileSync(mockPatchPath, 'utf8')
    appendFileSync(
      mockPatchPath,
      '\n# --- mock model (transient, restored after the run) ---\n' +
        '- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config:\n    providers:\n      e2e-mock:\n' +
        `        api: openai-completions\n        baseURL: ${mockUrl}\n        apiKeyEnv: E2E_MOCK_KEY\n` +
        '        models:\n          - id: mock-echo\n            contextWindow: 32768\n            maxTokens: 2048\n' +
        '            reasoningEfforts: false\n' +
        '- id: agent-default-model\n  name: "@deepseek-ai/dsh-agent-default-model"\n  config:\n' +
        '    provider: e2e-mock\n    model: mock-echo\n',
    )
    log('default model switched to e2e-mock/mock-echo for this run')
  } else {
    officialMockUrl = mockUrl
  }
}

// --- pre-run isolation snapshot of the user's real DSH home ---
const userWorkspaceHashBefore = sha256(join(DSH_HOME_ROOT, 'storages/workspace.json'))
const userCredentialsHashBefore = sha256(join(DSH_HOME_ROOT, '.credentials.yaml'))
const userSessionsBefore = listSessionsDirs()

// --- boot the instance ---
const env = { ...process.env }
if (MOCK_PROVIDER === 'simple') env.E2E_MOCK_KEY = 'dsh-e2e-mock'
if (MOCK_PROVIDER === 'official' && officialMockUrl) {
  // The production adapter resolves its endpoint from this env var; the mock accepts any key.
  env.DEEPSEEK_BASE_URL = officialMockUrl
  env.DEEPSEEK_API_KEY = 'mock-key'
}
if (process.env.DSH_E2E_HOME) {
  env.DSH_HOME = process.env.DSH_E2E_HOME
  env.DSH_AGENTS_HOME = join(process.env.DSH_E2E_HOME, 'agents')
} else {
  delete env.DSH_HOME // share the real ~/.dsh home: that is where the credentials live
  delete env.DSH_AGENTS_HOME
}
const t0 = Date.now()
const child = spawn(DSH, ['--profile', PROFILE, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: WORKSPACE,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => (stdout += d))
child.stderr.on('data', (d) => (stderr += d))
const exited = new Promise((resolveExit) => child.on('exit', (code, signal) => resolveExit({ code, signal })))

const url = await new Promise((resolveUrl, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`timeout waiting for URL\nstdout=${sanitize(stdout)}\nstderr=${sanitize(stderr)}`)),
    90_000,
  )
  const check = () => {
    const m = stdout.match(/http:\/\/[^\s]*\?token=[A-Za-z0-9_-]+/)
    if (m) {
      clearTimeout(timer)
      resolveUrl(m[0])
    }
  }
  child.stdout.on('data', check)
  child.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`instance exited early code=${code}\nstderr=${sanitize(stderr)}`))
  })
})
const bootMs = Date.now() - t0
const port = Number(new URL(url).port)
log(`instance ready in ${bootMs} ms on http://127.0.0.1:${port}/ (token redacted)`)

for (let i = 0; i < 50; i++) {
  if (await tcpOpen(port)) break
  await new Promise((r) => setTimeout(r, 100))
}

// --- run Playwright ---
const results = { runId, bootMs, port, profile: PROFILE, workspace: WORKSPACE, state: STATE }
let testExitCode = 1
try {
  const pw = spawn(
    process.execPath,
    [join(HARNESS, 'node_modules/playwright/cli.js'), 'test', '--config', join(HARNESS, 'playwright.config.mjs')],
    {
      cwd: HARNESS,
      env: {
        ...env,
        DSH_E2E_URL: url, // ephemeral: handed to the test process via env only
        DSH_E2E_ARTIFACTS: shotDir,
        DSH_E2E_RUN_DIR: runDir,
        DSH_E2E_ROOT: ROOT,
        DSH_E2E_REAL_MODEL: REAL_MODEL ? '1' : '0',
        // Passthrough so `DSH_E2E_SELF_FAIL=1 node e2e/run-e2e.mjs` runs the
        // deliberate-failure evidence self-check; the evidence reporter also
        // receives the same runId as this runner's run directory.
        DSH_E2E_SELF_FAIL: process.env.DSH_E2E_SELF_FAIL || '',
        DSH_E2E_RUN_ID: runId,
        DSH_E2E_MOCK_MODEL: MOCK_MODEL ? '1' : '0',
        DSH_E2E_MOCK_PROVIDER: MOCK_PROVIDER || '',
        DSH_E2E_MOCK_RECORD: mockRecordPath || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const pwOut = []
  pw.stdout.on('data', (d) => {
    pwOut.push(d)
    process.stdout.write(sanitize(d))
  })
  pw.stderr.on('data', (d) => {
    pwOut.push(d)
    process.stderr.write(sanitize(d))
  })
  testExitCode = await new Promise((resolvePw) => pw.on('exit', (code) => resolvePw(code ?? 1)))
  results.playwrightOutput = sanitize(pwOut.join(''))
} finally {
  if (child.exitCode === null) child.kill('SIGTERM')
  const stopBy = Date.now() + 8000
  while (child.exitCode === null && Date.now() < stopBy) await new Promise((r) => setTimeout(r, 100))
  if (child.exitCode === null) child.kill('SIGKILL')
  await exited
  let portReleased = false
  for (let i = 0; i < 50; i++) {
    if (!(await tcpOpen(port))) {
      portReleased = true
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  const leftoverAfter = await grep(HOST_PATTERN)
  results.portReleased = portReleased
  results.leftoverProcesses = leftoverAfter
  log(`instance stopped; port ${port} released=${portReleased}; leftover ${PROFILE} processes=${leftoverAfter.length}`)

  const userWorkspaceHashAfter = sha256(join(DSH_HOME_ROOT, 'storages/workspace.json'))
  const userCredentialsHashAfter = sha256(join(DSH_HOME_ROOT, '.credentials.yaml'))
  const userSessionsAfter = listSessionsDirs()
  results.isolation = {
    userWorkspaceJsonUnchanged: userWorkspaceHashBefore === userWorkspaceHashAfter,
    userCredentialsUnchanged: userCredentialsHashBefore === userCredentialsHashAfter,
    userSessionsDirUnchanged: JSON.stringify(userSessionsBefore) === JSON.stringify(userSessionsAfter),
    newUserSessionDirs: userSessionsAfter.filter((d) => !userSessionsBefore.includes(d)),
    desktopProfileTouched: false,
    stateRoot: STATE,
    sessionRootsUnderState: existsSync(join(STATE, 'sessions')) ? readdirSync(join(STATE, 'sessions')) : [],
  }
  log(
    `isolation: workspace.json unchanged=${results.isolation.userWorkspaceJsonUnchanged}, ` +
      `sessions dirs unchanged=${results.isolation.userSessionsDirUnchanged}, credentials unchanged=${results.isolation.userCredentialsUnchanged}`,
  )

  // Restore the profile patch and stop the mock provider even when tests failed.
  if (originalProfilePatch !== null && mockPatchPath) writeFileSync(mockPatchPath, originalProfilePatch)
  if (mockProvider && mockProvider.exitCode === null) {
    mockProvider.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 300))
    if (mockProvider.exitCode === null) mockProvider.kill('SIGKILL')
  }
  if (mockRecordPath && existsSync(mockRecordPath)) {
    const lines = readFileSync(mockRecordPath, 'utf8').trim().split('\n').filter(Boolean).length
    results.mockProvider = { provider: MOCK_PROVIDER, record: mockRecordPath, requests: lines }
    log('mock provider: model requests served =', lines)
  }

  const latest = join(ARTIFACTS, 'latest')
  rmSync(latest, { recursive: true, force: true })
  cpSync(shotDir, latest, { recursive: true })
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(results, null, 2))
  writeFileSync(join(ARTIFACTS, 'last-run.json'), JSON.stringify(results, null, 2))
  const shots = readdirSync(shotDir).sort()
  log('screenshots:', shots.map((f) => join(shotDir, f)).join(', ') || '(none)')
}

writeFileSync(join(ARTIFACTS, 'latest-run-dir.txt'), runDir + '\n')
const ok =
  testExitCode === 0 &&
  results.portReleased &&
  results.leftoverProcesses.length === 0 &&
  results.isolation.userWorkspaceJsonUnchanged &&
  results.isolation.userSessionsDirUnchanged
log(ok ? 'RESULT: PASS' : `RESULT: FAIL (tests=${testExitCode}, portReleased=${results.portReleased}, leftovers=${results.leftoverProcesses.length})`)
process.exit(ok ? 0 : 1)

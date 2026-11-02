#!/usr/bin/env node
/**
 * Produce distributable artifacts for the control plane:
 *   dist/dsh-control-plane-session-tree-<version>.tgz   (our vendored+modified bundle)
 *   dist/INSTALL.md                                     (one command + GUI path)
 *   dist/manifest.json                                  (exact specs + requirement coverage)
 *
 * The other components are already published (npm / pinned git), so packaging
 * only has to pin them by exact version/commit. `npm publish` steps are printed
 * but never executed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(REPO, 'dist')
const VENDORED = join(REPO, 'third_party/dsh-session-tree')

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

const pkg = JSON.parse(readFileSync(join(VENDORED, 'package.json'), 'utf8'))
const packed = execFileSync('npm', ['pack', '--pack-destination', DIST], { cwd: VENDORED, encoding: 'utf8' })
  .trim()
  .split('\n')
  .pop()
const tarball = join(DIST, packed)
if (!existsSync(tarball)) throw new Error(`npm pack did not produce ${packed}`)

// Runtime-only whitelist: build assets stay in the repo, never in the tarball.
const listed = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.replace(/^package\//, ''))
  .filter(Boolean)
const forbidden = listed.filter((file) => /^(client\.template\.js|avatars\/|scripts\/|tests\/)/.test(file))
if (forbidden.length) throw new Error(`tarball contains build-only files: ${forbidden.join(', ')}`)
for (const required of ['client.js', 'index.js', 'cordis.patch.yml', 'package.json']) {
  if (!listed.includes(required)) throw new Error(`tarball is missing ${required}`)
}
console.log(`[pack] vendored bundle: ${tarball} (${listed.length} runtime files, verified)`)

const SPECS = [
  `file:${tarball.replace(DIST + '/', '')}`,
  'github:funk80rus/dsh-agent-teams-model-override#1bbe0891710264a5bc4b517045f785204e6a652c',
  'dsh-workflow-map@1.0.0',
  'dsh-local-telemetry@0.2.1',
  'dshmarket@1.73.8',
]
const coverage = {
  'dsh-control-plane-session-tree': 'R7 sidebar session tree; R8 six task avatars',
  'dsh-agent-teams-model-override': 'R1 nested teams; R3 roster; R5 cold resume; R6 per-member model',
  'dsh-workflow-map': 'R10 workflow map; R11 node/progress view',
  'dsh-local-telemetry': 'R18 local telemetry store; R15 run statistics (partial)',
  dshmarket: 'R13 plugin install/upgrade/uninstall UX',
}

const manifest = {
  name: 'dsh-agent-control-plane',
  version: '0.1.0',
  builtAt: new Date().toISOString(),
  dsh: '0.2.1-rc.5',
  artifacts: readdirSync(DIST).filter((f) => f.endsWith('.tgz')),
  components: SPECS.map((spec) => ({ spec, covers: coverage[Object.keys(coverage).find((k) => spec.includes(k))] })),
}
writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

const installMd = `# DSH Agent 控制面 · 安装说明（生成于 ${manifest.builtAt}）

目标宿主：DeepSeek Harness \`0.2.1-rc.5\`（已验证的真机版本）。

## 一条命令（普通 profile / 测试 profile）

在本目录执行：

\`\`\`sh
dsh plugin --profile <profile> add ${SPECS.map((s) => `'${s}'`).join(' ')}
\`\`\`

（\`dsh plugin add\` 会自动把每个 bundle 登记到 profile 的 \`dsh.profile.bundles\` 并安装依赖；
装完重启对应实例。）

## desktop 正式 profile

desktop profile 由 Electron 应用独占管理，建议二选一：

1. **GUI**：应用内 **Settings → Plugins → Add plugin**，依次添加上面每一个 spec
   （本地 tarball 用本目录 \`${packed}\` 的绝对路径）。
2. **应用完全退出后**执行：
   \`\`\`sh
   node delivery/install.mjs --profile desktop --yes
   \`\`\`
   然后重新打开 DSH。

## 回滚

\`\`\`sh
node delivery/uninstall.mjs --profile <profile>
\`\`\`

安装器在写入前会把 profile 的 \`package.json\` / \`cordis.patch.yml\` 快照到
\`.control-plane-backup/<时间戳>/\`，回滚即恢复该快照。

## 覆盖范围

${Object.entries(coverage)
  .map(([name, covers]) => `- \`${name}\` — ${covers}`)
  .join('\n')}

未覆盖（需自研或上游扩展）：R2 团队级深度原子门禁、R4 自动建队、R9 任务驱动标题、
R12 复用策略、R14 默认权限终验、R16 utility 库、R17 全量视觉/无障碍验收。
`

writeFileSync(join(DIST, 'INSTALL.md'), installMd)
console.log('[pack] wrote dist/INSTALL.md and dist/manifest.json')
console.log('[pack] publish (manual, not executed):')
console.log(`  cd ${VENDORED} && npm publish --access public`)

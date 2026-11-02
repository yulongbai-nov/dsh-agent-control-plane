#!/usr/bin/env node
/**
 * Package the last E2E report (HTML + markdown + per-case videos) into a single
 * zip for GitHub Release / artifact distribution.
 *
 *   node delivery/pack-report.mjs [--source <artifacts/latest/report>] [--version 0.2.0]
 *
 * Output: dist/e2e-report-<version>.zip  (+ dist/e2e-report-<version>.md copy)
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const version = flag('--version', JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: REPO, encoding: 'utf8' })).version)
const root = process.env.DSH_E2E_ROOT || '/tmp/dsh-e2e'
const source = flag('--source', join(root, 'artifacts/latest/report'))

if (!existsSync(join(source, 'report.html'))) {
  console.error(`[pack-report] no report at ${source}; run the E2E suite first`)
  process.exit(1)
}
mkdirSync(join(REPO, 'dist'), { recursive: true })
const zip = join(REPO, 'dist', `e2e-report-${version}.zip`)
rmSync(zip, { force: true })
execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: source })
cpSync(join(source, 'report.md'), join(REPO, 'dist', `e2e-report-${version}.md`))
const size = (execFileSync('du', ['-h', zip], { encoding: 'utf8' }).split('\t')[0] || '').trim()
console.log(`[pack-report] wrote ${zip} (${size})`)
console.log(`[pack-report] wrote ${join(REPO, 'dist', `e2e-report-${version}.md`)}`)

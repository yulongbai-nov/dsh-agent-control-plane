#!/usr/bin/env node
/**
 * Publish the generated mobile site to the `gh-pages` branch and make sure
 * GitHub Pages serves it.
 *
 *   node delivery/publish-pages.mjs [--site dist/pages] [--branch gh-pages]
 *
 * Uses an orphan temp repo so the main history stays clean. Requires `gh` login
 * with repo scope (the same credential used by the rest of the repo tooling).
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const site = flag('--site', join(REPO, 'dist/pages'))
const branch = flag('--branch', 'gh-pages')
if (!existsSync(join(site, 'index.html'))) {
  console.error(`[publish-pages] no site at ${site}; run build-pages.mjs first`)
  process.exit(1)
}

const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO, encoding: 'utf8' }).trim()
const work = mkdtempSync(join(tmpdir(), 'dsh-pages-'))
cpSync(site, work, { recursive: true })
const run = (args) => execFileSync('git', args, { cwd: work, stdio: 'pipe' })
run(['init', '-q'])
run(['checkout', '-q', '-b', branch])
run(['add', '-A'])
run(['-c', 'user.name=DSH Agent', '-c', 'user.email=agent@local', 'commit', '-q', '-m', 'docs: publish mobile E2E report site'])
run(['remote', 'add', 'origin', remote])
execFileSync('git', ['push', '-q', '-f', 'origin', branch], { cwd: work, stdio: 'pipe' })

// Enable / refresh Pages (idempotent: 409 means it already exists).
try {
  execFileSync('gh', ['api', '-X', 'POST', `repos/{owner}/{repo}/pages`, '-f', `source[branch]=${branch}`, '-f', 'source[path]=/'], {
    cwd: REPO,
    stdio: 'pipe',
  })
  console.log('[publish-pages] Pages enabled')
} catch (error) {
  const message = String(error.stderr || error.message)
  if (/409|already/i.test(message)) console.log('[publish-pages] Pages already enabled')
  else console.log('[publish-pages] Pages API:', message.slice(0, 300))
}
writeFileSync(join(work, 'latest.txt'), new Date().toISOString() + '\n')
const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd: REPO, encoding: 'utf8' }).trim()
console.log(`[publish-pages] pushed ${branch} to ${repo}`)
console.log(`[publish-pages] https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/`)

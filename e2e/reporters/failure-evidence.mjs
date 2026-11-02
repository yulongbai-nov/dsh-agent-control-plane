/**
 * Playwright reporter: collect screenshot / video / trace evidence for every
 * failed test into
 *
 *   ${DSH_E2E_ARTIFACTS}/failures/<runId>/<test-slug>/
 *
 * and convert the retained WebM screen recording into an animated GIF.
 *
 * Files per failure:
 *   failure.png       screenshot (only-on-failure)
 *   failure.webm      screen recording (retain-on-failure)
 *   failure.gif       animated GIF made from the recording
 *   trace.zip         Playwright trace (retain-on-failure)
 *   error.txt         error message + stack
 *   evidence.json     machine-readable index for CI artifacts / upload
 *
 * A failing reporter never fails the run: every step is guarded, and a missing
 * ffmpeg only degrades the GIF (`evidence.json` records the reason).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { webmToGif } from './gif-from-webm.mjs'

const FAILED_STATUSES = new Set(['failed', 'timedOut', 'interrupted'])

const slug = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'test'

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

const contentTypeExt = (contentType) =>
  contentType === 'text/markdown' ? '.md' : contentType === 'application/json' ? '.json' : contentType === 'text/plain' ? '.txt' : ''

/** Pick a friendly, collision-free namespace for one test result. */
function testSlug(test) {
  const path = test.titlePath().filter(Boolean).filter((part) => part !== '')
  const tail = path.slice(-2).join('-')
  return slug(tail || test.title)
}

export default class FailureEvidenceReporter {
  constructor(options = {}) {
    this.artifactsRoot =
      options.artifacts || process.env.DSH_E2E_ARTIFACTS || '/tmp/dsh-e2e/artifacts/latest'
    this.runId = options.runId || process.env.DSH_E2E_RUN_ID || stamp()
    this.failures = []
    this.seenSlugs = new Map()
  }

  onBegin() {
    this.failureRoot = join(this.artifactsRoot, 'failures', this.runId)
    mkdirSync(this.failureRoot, { recursive: true })
    console.log(`[failure-evidence] failure artifacts root: ${this.failureRoot}`)
  }

  onTestEnd(test, result) {
    if (!FAILED_STATUSES.has(result.status) && result.status !== 'timedOut') return
    if (result.status === 'timedOut' && !result.error) return
    // A clean pass/skip never reaches here; a retried test's earlier failed
    // attempt is still evidence, so record every failed attempt.
    const base = testSlug(test)
    const seen = (this.seenSlugs.get(base) ?? 0) + 1
    this.seenSlugs.set(base, seen)
    const slugName = seen === 1 ? base : `${base}-retry${seen - 1}`
    this.failures.push({ test, result, slugName })
  }

  async onEnd(runResult) {
    if (!this.failures.length) {
      console.log('[failure-evidence] no failures — nothing to collect')
      return
    }
    const index = []
    for (const { test, result, slugName } of this.failures) {
      try {
        const dir = join(this.failureRoot, slugName)
        mkdirSync(dir, { recursive: true })
        const entry = await this.collectOne(test, result, dir)
        index.push(entry)
        console.log(
          `[failure-evidence] ${slugName}: png=${Boolean(entry.artifacts.png)} ` +
            `webm=${Boolean(entry.artifacts.webm)} gif=${entry.gif.ok ? entry.gif.gif : 'unavailable'} ` +
            `trace=${Boolean(entry.artifacts.trace)}`,
        )
      } catch (err) {
        console.warn(`[failure-evidence] could not collect ${slugName}: ${err instanceof Error ? err.message : err}`)
      }
    }
    try {
      writeFileSync(
        join(this.failureRoot, 'index.json'),
        JSON.stringify({ runId: this.runId, status: runResult?.status, failures: index }, null, 2),
      )
      console.log(`[failure-evidence] ${index.length} failure(s) collected under ${this.failureRoot}`)
    } catch (err) {
      console.warn(`[failure-evidence] could not write index.json: ${err instanceof Error ? err.message : err}`)
    }
  }

  async collectOne(test, result, dir) {
    const artifacts = { png: null, webm: null, trace: null, others: [] }
    const attachmentSummary = []

    for (const attachment of result.attachments ?? []) {
      const name = `${attachment.name ?? ''}`.toLowerCase()
      const body = attachment.body && !attachment.path ? attachment.body : null
      const source = attachment.path && existsSync(attachment.path) ? attachment.path : null
      try {
        if (name.includes('screenshot') || attachment.contentType === 'image/png') {
          const dest = join(dir, artifacts.png ? `failure-${attachmentSummary.length}.png` : 'failure.png')
          if (source) copyFileSync(source, dest)
          else if (body) writeFileSync(dest, body)
          else continue
          artifacts.png = dest
        } else if (name.includes('video') || attachment.contentType === 'video/webm') {
          const dest = join(dir, 'failure.webm')
          if (source) copyFileSync(source, dest)
          else if (body) writeFileSync(dest, body)
          else continue
          artifacts.webm = dest
        } else if (name.includes('trace') || attachment.contentType === 'application/zip') {
          const dest = join(dir, 'trace.zip')
          if (source) copyFileSync(source, dest)
          else if (body) writeFileSync(dest, body)
          else continue
          artifacts.trace = dest
        } else {
          if (source) {
            const ext = contentTypeExt(attachment.contentType)
            const dest = join(dir, slug(attachment.name || 'attachment') + ext)
            copyFileSync(source, dest)
            artifacts.others.push(dest)
          }
        }
      } catch (err) {
        attachmentSummary.push({ name: attachment.name, error: String(err) })
      }
      attachmentSummary.push({ name: attachment.name, contentType: attachment.contentType, collected: Boolean(source || body) })
    }

    // error text
    const message = result.error?.message ?? result.errors?.[0]?.message ?? ''
    const stack = result.error?.stack ?? result.errors?.[0]?.stack ?? ''
    writeFileSync(join(dir, 'error.txt'), `${message}\n\n${stack}`.trim() || '(no error text)')

    // video → gif
    let gif = { ok: false, gif: null, reason: '没有录制视频（video 未保留）' }
    if (artifacts.webm) gif = await webmToGif(artifacts.webm, join(dir, 'failure.gif'))

    const entry = {
      runId: this.runId,
      title: test.title,
      titlePath: test.titlePath().filter(Boolean),
      file: test.location?.file ?? null,
      line: test.location?.line ?? null,
      status: result.status,
      retry: result.retry,
      durationMs: result.duration,
      startedAt: new Date(test.results?.[0]?.startTime ?? Date.now()).toISOString(),
      error: { message, stack },
      artifacts,
      gif,
      attachments: attachmentSummary,
    }
    writeFileSync(join(dir, 'evidence.json'), JSON.stringify(entry, null, 2))
    return entry
  }
}

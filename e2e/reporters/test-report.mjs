import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describeTest } from '../test-cases.mjs'

/**
 * Playwright reporter: records EVERY test (passed / failed / skipped) and writes
 * a human-readable report with its own video recording.
 *
 * Output under $DSH_E2E_ARTIFACTS/report/:
 *   report.md      — markdown table + per-case description
 *   report.html    — styled page with an embedded <video> per executed case
 *   summary.json   — machine-readable rows (for CI / release packaging)
 *   videos/*.webm  — one recording per executed case
 *   images/*.png   — failure screenshots when present
 *
 * The report only runs at the end of the whole test run, after Playwright has
 * finalized attachment files.
 */

const STATUS = { passed: '✅ 通过', failed: '❌ 失败', timedOut: '⏱️ 超时', skipped: '⏭️ 跳过', interrupted: '⛔ 中断' }
const ICON = { passed: '✅', failed: '❌', timedOut: '⏱️', skipped: '⏭️', interrupted: '⛔' }

const slug = (text) =>
  String(text)
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'case'

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

export default class TestReport {
  constructor() {
    this.rows = []
    this.startedAt = new Date()
  }

  onTestEnd(test, result) {
    const full = test.titlePath().filter(Boolean).join(' › ')
    const catalog = describeTest(full)
    this.rows.push({
      full,
      group: catalog.group,
      what: catalog.what,
      status: result.status,
      durationMs: result.duration,
      attempt: result.retry + 1,
      videoPath: result.attachments.find((a) => a.name === 'video')?.path || null,
      screenshotPath: result.attachments.find((a) => a.name === 'screenshot')?.path || null,
    })
  }

  onEnd(result) {
    const root = process.env.DSH_E2E_ARTIFACTS || '/tmp/dsh-e2e/artifacts/latest'
    const dir = join(root, 'report')
    const videosDir = join(dir, 'videos')
    const imagesDir = join(dir, 'images')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(videosDir, { recursive: true })
    mkdirSync(imagesDir, { recursive: true })

    const rows = this.rows
      .sort((a, b) => a.full.localeCompare(b.full))
      .map((row, index) => {
        const number = String(index + 1).padStart(2, '0')
        const name = `${number}-${slug(row.full)}`
        let videoRel = null
        if (row.status !== 'skipped' && row.videoPath && existsSync(row.videoPath)) {
          const target = join(videosDir, `${name}.webm`)
          copyFileSync(row.videoPath, target)
          videoRel = `videos/${basename(target)}`
        }
        let imageRel = null
        if (row.status !== 'skipped' && row.screenshotPath && existsSync(row.screenshotPath)) {
          const target = join(imagesDir, `${name}.png`)
          copyFileSync(row.screenshotPath, target)
          imageRel = `images/${basename(target)}`
        }
        return { ...row, number, videoRel, imageRel }
      })

    const counts = rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1
      return acc
    }, {})
    const totalMs = rows.reduce((sum, row) => sum + row.durationMs, 0)
    const summary = {
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      profile: process.env.DSH_E2E_PROFILE || 'e2e',
      mockProvider: process.env.DSH_E2E_MOCK_MODEL === '1',
      counts,
      totalDurationMs: totalMs,
      rows: rows.map((row) => ({
        number: row.number,
        group: row.group,
        full: row.full,
        what: row.what,
        status: row.status,
        durationMs: row.durationMs,
        video: row.videoRel,
        image: row.imageRel,
      })),
    }
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')

    // ---- markdown ----
    const lines = [
      '# E2E 报告',
      '',
      `生成时间：${summary.generatedAt}`,
      `profile：\`${summary.profile}\` ｜ mock 模型：${summary.mockProvider ? '是（零成本）' : '否'}`,
      '',
      `**结果：${Object.entries(counts)
        .map(([status, count]) => `${STATUS[status] || status} ${count}`)
        .join(' ｜ ')}** ｜ 用例总耗时 ${(totalMs / 1000).toFixed(1)}s`,
      '',
      '每个用例都有独立录像（`videos/`，webm）。失败用例额外有截图与 `failure-evidence` 收集的 GIF/trace。',
      '',
      '| # | 分组 | 用例 | 在验证什么 | 结果 | 耗时 | 录像 |',
      '|---|---|---|---|---|---|---|',
      ...rows.map(
        (row) =>
          `| ${row.number} | ${row.group} | ${row.full.split(' › ').pop()} | ${row.what.replace(/\|/g, '\\|')} | ${
            ICON[row.status] || row.status
          } | ${(row.durationMs / 1000).toFixed(1)}s | ${row.videoRel ? `[▶](${row.videoRel})` : '—'} |`,
      ),
      '',
      '> 录像/截图路径相对本报告目录；完整压缩包见 GitHub Release 的 `e2e-report-<version>.zip`。',
    ]
    writeFileSync(join(dir, 'report.md'), lines.join('\n') + '\n')

    // ---- html ----
    const tableRows = rows
      .map(
        (row) => `<tr class="${row.status}">
  <td>${row.number}</td>
  <td>${escapeHtml(row.group)}</td>
  <td><code>${escapeHtml(row.full)}</code></td>
  <td>${escapeHtml(row.what)}</td>
  <td class="status">${ICON[row.status] || row.status}</td>
  <td>${(row.durationMs / 1000).toFixed(1)}s</td>
  <td>${
    row.videoRel
      ? `<video controls muted preload="metadata" src="${row.videoRel}"></video><a href="${row.videoRel}">download</a>`
      : '—'
  }${row.imageRel ? `<a class="shot" href="${row.imageRel}">failure screenshot</a>` : ''}</td>
</tr>`,
      )
      .join('\n')
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DSH Agent 控制面 · E2E 报告</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.6 -apple-system, "Segoe UI", "PingFang SC", sans-serif; margin: 24px; }
  h1 { font-size: 20px; }
  .meta { color: #666; margin-bottom: 16px; }
  .badges span { display: inline-block; padding: 2px 8px; border-radius: 999px; margin-right: 6px; background: #eef2f7; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d8dee6; padding: 6px 8px; vertical-align: top; text-align: left; }
  th { background: #f5f7fa; position: sticky; top: 0; }
  tr.passed td.status { color: #12805c; }
  tr.failed td.status, tr.timedOut td.status { color: #c01e2e; font-weight: 600; }
  tr.failed { background: #fff5f5; }
  tr.skipped { color: #8a939e; }
  video { width: 240px; display: block; border-radius: 6px; border: 1px solid #d8dee6; }
  code { font-size: 12px; }
  a { color: #0b6bcb; }
  a.shot { display: block; margin-top: 4px; }
</style></head><body>
<h1>DSH Agent 控制面 · E2E 报告</h1>
<div class="meta">生成时间：${escapeHtml(summary.generatedAt)} ｜ profile：<code>${escapeHtml(summary.profile)}</code> ｜ mock 模型：${
      summary.mockProvider ? '是（零成本）' : '否'
    } ｜ 用例总耗时 ${(totalMs / 1000).toFixed(1)}s</div>
<div class="badges">${Object.entries(counts)
      .map(([status, count]) => `<span>${STATUS[status] || status} ${count}</span>`)
      .join('')}</div>
<p>每个用例都有独立录像（点击播放）；失败用例另有截图与 failure-evidence 的 GIF/trace。完整打包见 Release 附件。</p>
<table><thead><tr><th>#</th><th>分组</th><th>用例</th><th>在验证什么</th><th>结果</th><th>耗时</th><th>录像</th></tr></thead>
<tbody>
${tableRows}
</tbody></table>
</body></html>
`
    writeFileSync(join(dir, 'report.html'), html)

    // A small pointer for terminals / CI logs.
    writeFileSync(
      join(dir, 'README.txt'),
      `E2E report: ${join(dir, 'report.html')}\n` +
        `videos: ${videosDir}\n` +
        `counts: ${JSON.stringify(counts)}\n`,
    )
    console.log(`[test-report] wrote ${join(dir, 'report.html')} (${rows.length} cases, videos: ${rows.filter((r) => r.videoRel).length})`)
    void result
  }
}

#!/usr/bin/env node
/**
 * Build a mobile-friendly static site from the last E2E report.
 *
 *   FFMPEG_PATH=/path/to/ffmpeg node delivery/build-pages.mjs [--report <dir>] [--out dist/pages]
 *
 * Converts every case recording from webm to H.264/MP4 (+poster JPG) so iOS/Android
 * browsers can play it inline, and writes a single page with all cases.
 * Publish with `node delivery/publish-pages.mjs`.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const root = process.env.DSH_E2E_ROOT || '/tmp/dsh-e2e'
const reportDir = flag('--report', join(root, 'artifacts/latest/report'))
const outDir = flag('--out', join(REPO, 'dist/pages'))
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'

if (!existsSync(join(reportDir, 'summary.json'))) {
  console.error(`[build-pages] no summary.json under ${reportDir}; run the E2E suite first`)
  process.exit(1)
}
const summary = JSON.parse(readFileSync(join(reportDir, 'summary.json'), 'utf8'))
rmSync(outDir, { recursive: true, force: true })
mkdirSync(join(outDir, 'videos'), { recursive: true })
mkdirSync(join(outDir, 'posters'), { recursive: true })

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

const run = (args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })

const ICON = { passed: '✅', failed: '❌', timedOut: '⏱️', skipped: '⏭️', interrupted: '⛔' }
let converted = 0
const rows = summary.rows.map((row) => {
  const base = `${row.number}-case`
  const videoOut = join(outDir, 'videos', `${base}.mp4`)
  const posterOut = join(outDir, 'posters', `${base}.jpg`)
  let video = null
  let poster = null
  if (row.video && existsSync(join(reportDir, row.video))) {
    const input = join(reportDir, row.video)
    run(['-i', input, '-vf', 'scale=960:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', videoOut])
    run(['-i', input, '-vf', 'scale=480:-2', '-frames:v', '1', '-q:v', '6', posterOut])
    video = `videos/${base}.mp4`
    poster = `posters/${base}.jpg`
    converted += 1
  }
  return { ...row, video, poster }
})

const counts = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1
  return acc
}, {})
const totalDuration = rows.reduce((sum, row) => sum + row.durationMs, 0)
const generated = new Date(summary.generatedAt).toLocaleString('zh-CN', { hour12: false })

const groups = [...new Set(rows.map((row) => row.group))]
const cards = groups
  .map((group) => {
    const items = rows
      .filter((row) => row.group === group)
      .map(
        (row) => `<article class="card ${row.status}">
  <div class="head"><span class="no">${row.number}</span><h3>${escapeHtml(row.full.split(' › ').pop())}</h3>
  <span class="badge">${ICON[row.status] || row.status} ${(row.durationMs / 1000).toFixed(1)}s</span></div>
  <p>${escapeHtml(row.what || '')}</p>
  ${row.video
    ? `<video controls playsinline preload="none" poster="../${row.poster || ''}" src="${row.video}"></video>`
    : `<p class="noplay">此用例本次未执行（跳过），无录像。</p>`}
</article>`,
      )
      .join('\n')
    return `<section><h2>${escapeHtml(group)}</h2><div class="grid">\n${items}\n</div></section>`
  })
  .join('\n')

const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>DSH Agent 控制面 · E2E 录像</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#1c1f23; --muted:#616a75; --line:#e2e6eb; --ok:#12805c; --bad:#c01e2e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --card:#171b21; --fg:#e8ebef; --muted:#9aa4b0; --line:#2a3038; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px 14px 40px; background:var(--bg); color:var(--fg);
         font:15px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; }
  h1 { font-size:20px; margin:0 0 6px; }
  .meta { color:var(--muted); font-size:13px; margin-bottom:10px; }
  .badges { display:flex; gap:6px; flex-wrap:wrap; margin:8px 0 18px; }
  .badges span { background:var(--card); border:1px solid var(--line); border-radius:999px; padding:2px 10px; font-size:12px; }
  h2 { font-size:15px; color:var(--muted); margin:22px 0 8px; font-weight:600; }
  .grid { display:grid; grid-template-columns:1fr; gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:10px 12px; }
  .card .head { display:flex; gap:8px; align-items:baseline; }
  .card h3 { font-size:15px; margin:0; flex:1; }
  .no { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .badge { font-size:12px; color:var(--muted); white-space:nowrap; }
  .card p { margin:6px 0 8px; color:var(--muted); font-size:13px; }
  video { width:100%; border-radius:8px; background:#000; display:block; }
  .noplay { color:var(--muted); font-size:13px; }
  .card.passed .badge { color:var(--ok); }
  .card.failed .badge, .card.timedOut .badge { color:var(--bad); }
  .card.skipped { opacity:.75; }
  footer { margin-top:28px; color:var(--muted); font-size:12px; }
  a { color:#0b6bcb; }
  @media (min-width:760px) { .grid { grid-template-columns:1fr 1fr; } video { max-height:320px; } }
</style></head>
<body>
<h1>DSH Agent 控制面 · E2E 录像</h1>
<div class="meta">生成于 ${generated} ｜ profile <code>${escapeHtml(summary.profile)}</code> ｜ mock 模型：${summary.mockProvider ? '是（零成本）' : '否'} ｜ 用例总耗时 ${(totalDuration / 1000).toFixed(1)}s</div>
<div class="badges">${Object.entries(counts).map(([status, count]) => `<span>${ICON[status] || status} ${status} × ${count}</span>`).join('')}<span>共 ${rows.length} 条</span></div>
<p class="meta">点视频即播（H.264，iOS/Android 浏览器原生支持）。每条用例上方是它的实际验证内容；跳过项本次未执行。</p>
<p class="meta">🎨 想看 10 个 workflow 模板的视图：<a href="templates/">Workflow 模板视图</a>（声明式拓扑 + 静态分析状态）。</p>
${cards}
<footer>
 仓库：<a href="https://github.com/yulongbai-nov/dsh-agent-control-plane">dsh-agent-control-plane</a> ·
  <a href="report.md">Markdown 报告</a> ·
  <a href="https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/tag/v0.2.0">Release v0.2.0</a>
</footer>
</body></html>
`
writeFileSync(join(outDir, 'index.html'), html)
copyFileSync(join(reportDir, 'report.md'), join(outDir, 'report.md'))
writeFileSync(join(outDir, '.nojekyll'), '')
const size = execFileSync('du', ['-sh', outDir], { encoding: 'utf8' }).split('\t')[0].trim()
console.log(`[build-pages] ${outDir}: ${rows.length} cards, ${converted} mp4 (${size})`)

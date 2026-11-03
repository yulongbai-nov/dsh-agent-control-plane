#!/usr/bin/env node
/**
 * Render the workflow-template views (declared topology) as a static page.
 *
 *   node workflow-templates/render-views.mjs [--out dist/pages/templates]
 *
 * Why "declared": the official engine receives a script with dynamic fan-out
 * (`items.map(...)`), which conservative static analysis intentionally refuses to
 * expand. Each template declares its shape (phases, parallel/pipeline, fan-out
 * sample sizes) next to the script, and this page renders that plus a static
 * analysis status badge.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKFLOW_TEMPLATES } from './index.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const outDir = flag('--out', join(REPO, 'dist/pages/templates'))

// Optional: run the repo's conservative static analyzer for a status badge.
let staticAnalysis = null
try {
  const require = createRequire(import.meta.url)
  const acorn = require(process.env.ACORN_PATH || 'acorn')
  const { extractTopology } = require(join(REPO, 'packages/workflow-topology/index.cjs'))
  staticAnalysis = (script, meta) => extractTopology(script, meta, { parse: acorn.parse })
} catch {
  staticAnalysis = null
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

const kindLabel = {
  'parallel-map': '并行（按 items 展开）',
  parallel: '并行（固定分支）',
  'pipeline-map': '流水线（按 items 并行展开）',
  single: '单步',
}

const nodeCard = (title, kind) => `<div class="node ${kind}"><span class="dot"></span>${escapeHtml(title)}</div>`

const renderPhase = (phase) => {
  let inner = ''
  if (phase.shape === 'single') inner = nodeCard(phase.template || phase.title, 'single')
  else if (phase.shape === 'parallel') inner = phase.nodes.map((node) => nodeCard(node, 'parallel')).join('')
  else {
    const sample = phase.sample || 3
    const template = phase.template || phase.title
    const rows = []
    for (let i = 0; i < sample; i++) {
      const label = template.replace(/\{\w+\}/g, `#${i + 1}`).replace(/ → /g, ' → ')
      rows.push(`<div class="lane ${phase.shape}">${label.split(' → ').map((part) => nodeCard(part, 'single')).join('<span class="arrow">→</span>')}</div>`)
    }
    inner = rows.join('') + `<div class="fanout">×${sample}（示意）</div>`
  }
  return `<section class="phase"><h4>${escapeHtml(phase.title)}</h4><div class="phase-body">${inner}</div><div class="shape">${escapeHtml(kindLabel[phase.shape] || phase.shape)}</div></section>`
}

const staticBadge = (template) => {
  if (!staticAnalysis) return '<span class="badge na">静态分析：未启用（缺 acorn）</span>'
  try {
    const graph = staticAnalysis(template.script, template.meta)
    if (graph.complete) return `<span class="badge ok">静态分析：完整（${graph.nodes.length} 节点）</span>`
    return `<span class="badge warn">静态分析：动态展开，仅可提取 ${graph.nodes.length} 个节点 / ${graph.warnings.length} 条告警（视图以声明为准）</span>`
  } catch (error) {
    return `<span class="badge na">静态分析：失败（${escapeHtml(String(error.message).slice(0, 60))}）</span>`
  }
}

const cards = WORKFLOW_TEMPLATES.map((template) => {
  const manifest = JSON.parse(readFileSync(join(REPO, 'workflow-templates/templates/manifest.json'), 'utf8'))
  const entry = manifest.templates.find((item) => item.name === template.name)
  const phases = entry.topology.phases.map(renderPhase).join('<div class="phase-arrow">→</div>')
  return `<article class="template" id="${escapeHtml(template.name)}">
  <header>
    <h3>${escapeHtml(template.name)}</h3>
    <span class="file">${escapeHtml(template.file)}</span>
  </header>
  <p class="when">${escapeHtml(template.whenToUse)}</p>
  <div class="flow">${phases}</div>
  <div class="meta">${staticBadge(template)}${entry.topology.note ? `<span class="badge note">${escapeHtml(entry.topology.note)}</span>` : ''}</div>
</article>`
}).join('\n')

const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Workflow 模板视图</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#1c1f23; --muted:#616a75; --line:#e2e6eb; --accent:#4a6cf7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --card:#171b21; --fg:#e8ebef; --muted:#9aa4b0; --line:#2a3038; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:18px 14px 50px; background:var(--bg); color:var(--fg);
         font:15px/1.55 -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; }
  h1 { font-size:20px; margin:0 0 6px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:18px; }
  .template { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; margin-bottom:14px; }
  .template header { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .template h3 { margin:0; font-size:16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .file { color:var(--muted); font-size:12px; font-family: ui-monospace, monospace; }
  .when { color:var(--muted); font-size:13px; margin:6px 0 12px; }
  .flow { display:flex; gap:8px; align-items:stretch; overflow-x:auto; padding-bottom:4px; }
  .phase { flex:0 0 auto; min-width:170px; background:color-mix(in srgb, var(--card) 80%, var(--accent) 5%); border:1px dashed var(--line); border-radius:10px; padding:8px; }
  .phase h4 { margin:0 0 6px; font-size:12px; color:var(--muted); text-transform:none; }
  .phase-body { display:flex; flex-direction:column; gap:6px; }
  .node { display:flex; align-items:center; gap:6px; background:var(--card); border:1px solid var(--accent); border-radius:8px; padding:5px 8px; font-size:12px; white-space:nowrap; }
  .node.parallel { border-style:double; }
  .dot { width:7px; height:7px; border-radius:50%; background:var(--accent); flex:none; }
  .arrow { color:var(--muted); font-size:12px; text-align:center; }
  .lane { display:flex; flex-direction:column; gap:2px; }
  .fanout { color:var(--muted); font-size:11px; margin-top:4px; }
  .shape { color:var(--muted); font-size:11px; margin-top:6px; }
  .phase-arrow { display:flex; align-items:center; color:var(--muted); font-size:18px; }
  .meta { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
  .badge { font-size:11px; border:1px solid var(--line); border-radius:999px; padding:2px 8px; color:var(--muted); }
  .badge.ok { color:#12805c; border-color:#12805c; }
  .badge.warn { color:#9a6700; border-color:#9a6700; }
  .badge.na { color:#c01e2e; border-color:#c01e2e; }
  a { color:var(--accent); }
  footer { color:var(--muted); font-size:12px; margin-top:20px; }
</style></head><body>
<h1>DSH Workflow 模板视图</h1>
<div class="sub">10 个模板的声明式拓扑（阶段 / 并行 / 流水线 / 展开示意）。动态 fan-out 的模板无法被保守静态分析完全展开，
这里以脚本声明为准，并附静态分析状态。点击手机版报告可看真实运行时的工作流地图录像。</div>
${cards}
<footer>
  模板源文件：<a href="https://github.com/yulongbai-nov/dsh-agent-control-plane/tree/main/workflow-templates/templates">workflow-templates/templates</a> ·
  真实运行视图：<a href="../">E2E 录像</a> ·
  官方 hook 契约：<code>agent / parallel / pipeline / phase / log / args</code>
</footer>
</body></html>
`
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'index.html'), html)
writeFileSync(join(outDir, '.nojekyll'), '')
console.log(`[render-views] ${outDir}/index.html (${WORKFLOW_TEMPLATES.length} templates)`)

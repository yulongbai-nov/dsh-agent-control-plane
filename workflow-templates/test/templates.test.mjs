import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKFLOW_TEMPLATES, findTemplate, HOST_CONTRACT } from '../index.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const HOOKS = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'args']

test('manifest 声明的模板都存在、名字唯一、meta 符合官方形状', () => {
  assert.ok(WORKFLOW_TEMPLATES.length >= 8, 'expect a useful template library')
  const names = WORKFLOW_TEMPLATES.map((template) => template.name)
  assert.equal(new Set(names).size, names.length, 'template names must be unique')
  for (const template of WORKFLOW_TEMPLATES) {
    assert.ok(template.meta.name)
    assert.ok(template.meta.description)
    assert.ok(Array.isArray(template.meta.phases) && template.meta.phases.length > 0)
    for (const phase of template.meta.phases) assert.equal(typeof phase.title, 'string')
  }
  assert.match(HOST_CONTRACT, /dsh-tool-workflow/)
})

test('所有脚本能在官方 hook 签名下编译（top-level await + 参数）', () => {
  for (const template of WORKFLOW_TEMPLATES) {
    assert.doesNotThrow(
      () => new AsyncFunction(...HOOKS, template.script),
      `${template.file} does not compile with the official hook signature`,
    )
  }
})

test('脚本不触碰文件系统/网络/进程（工作由 agent 完成）', () => {
  const forbidden = /\b(require|process\.env|child_process|fs\.|fetch\(|XMLHttpRequest|setTimeout|setInterval)\b/
  for (const template of WORKFLOW_TEMPLATES) {
    assert.doesNotMatch(template.script, forbidden, `${template.file} must stay inside the workflow sandbox`)
  }
})

test('脚本以 JSON return 结束，且声明过的 phase 都在脚本里出现', () => {
  for (const template of WORKFLOW_TEMPLATES) {
    const body = template.script.trim()
    assert.match(body, /return\s+\{/, `${template.file} must return a JSON object`)
    for (const phase of template.meta.phases) {
      assert.ok(
        template.script.includes(`phase('${phase.title}')`) || template.script.includes(`phase("${phase.title}")`),
        `${template.file} declares phase "${phase.title}" but never calls phase()`,
      )
    }
  }
})

test('findTemplate 能按名字取到脚本', () => {
  const template = findTemplate('code-audit')
  assert.ok(template)
  assert.match(template.script, /args\?\.files/)
  assert.equal(findTemplate('does-not-exist'), undefined)
})

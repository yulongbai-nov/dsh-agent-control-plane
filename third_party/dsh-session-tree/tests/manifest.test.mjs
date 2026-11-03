import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const pkg = JSON.parse(read('package.json'))

test('exports 指向的文件都存在', () => {
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key.includes('*')) continue
    assert.ok(existsSync(join(root, value)), `exports[${key}] -> ${value} missing`)
  }
})

test('files 白名单里的路径都存在', () => {
  for (const entry of pkg.files) {
    assert.ok(existsSync(join(root, entry)), `files entry missing: ${entry}`)
  }
})

test('cordis.patch 的 row name 等于包名', () => {
  const patch = read('cordis.patch.yml')
  assert.ok(patch.includes(`name: '${pkg.name}'`), 'row name must equal package name')
  assert.ok(patch.includes('id: session-tree'), 'stable row id')
})

test('client.js 内嵌六类头像 × 三套变体 data URL', () => {
  const client = read('client.js')
  const start = client.indexOf('const AVATAR_SRC = ')
  assert.ok(start >= 0, 'AVATAR_SRC assignment missing')
  const lineEnd = client.indexOf('\n', start)
  const json = client.slice(start + 'const AVATAR_SRC = '.length, lineEnd).trim().replace(/;\s*$/, '')
  const embedded = JSON.parse(json)
  for (const type of ['lead', 'research', 'code', 'write', 'data', 'qa']) {
    assert.ok(embedded[type], `avatar ${type} missing`)
    for (const variant of ['a', 'b', 'c']) {
      assert.match(embedded[type][variant] || '', /^data:image\/(png|jpeg);base64,/, `${type}/${variant} missing`)
    }
  }
})

test('locale 文件 JSON 合法且键一致', () => {
  const en = JSON.parse(read('locale/en.json'))
  const zh = JSON.parse(read('locale/zh.json'))
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})

test('bundle 声明包含 patch 与 client 注入', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0)
  assert.ok(pkg.engines.dsh, 'engines.dsh declares the tested host range')
})

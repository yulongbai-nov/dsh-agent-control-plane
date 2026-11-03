// Embed the avatar sets into client.template.js and write the single-file client.js
// that DSH's ModuleLoader serves. `--check` compares without writing.
//
// Sets: <role>.png -> variant "a" (original), <role>-b.jpg -> "b", <role>-c.jpg -> "c".
// A session picks one variant deterministically from its id, so the UI shows role-
// appropriate avatars with visual variety instead of one fixed picture per role.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const template = readFileSync(join(root, 'client.template.js'), 'utf8')
const marker = '/*__AVATAR_DATA__*/ null'
if (!template.includes(marker)) throw new Error(`avatar marker missing from client.template.js`)

const TYPES = ['lead', 'research', 'code', 'write', 'data', 'qa']
const VARIANTS = ['a', 'b', 'c']
const avatars = {}
for (const type of TYPES) avatars[type] = {}
for (const file of readdirSync(join(root, 'avatars')).sort()) {
  if (!/\.(png|jpg|jpeg)$/i.test(file)) continue
  const match = file.match(/^([a-z]+)(?:-([bc]))?\.(png|jpg|jpeg)$/i)
  if (!match) continue
  const [, type, letter] = match
  if (!TYPES.includes(type)) continue
  const variant = letter || 'a'
  const bytes = readFileSync(join(root, 'avatars', file))
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'application/octet-stream'
  avatars[type][variant] = `data:${mime};base64,${bytes.toString('base64')}`
}
for (const type of TYPES) {
  for (const variant of VARIANTS) {
    if (!avatars[type][variant]) throw new Error(`missing avatar: ${type} variant ${variant}`)
  }
}

const output = template.replace(marker, JSON.stringify(avatars))
const target = join(root, 'client.js')
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8')
  if (current !== output) {
    console.error('client.js is stale: run `node scripts/build.mjs`')
    process.exit(1)
  }
  console.log(`client.js up to date (${output.length} bytes)`)
} else {
  writeFileSync(target, output)
  console.log(`client.js written (${output.length} bytes, avatars: ${Object.keys(avatars).join(', ')})`)
}

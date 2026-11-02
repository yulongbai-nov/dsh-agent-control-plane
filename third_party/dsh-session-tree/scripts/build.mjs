// Embed the six avatar PNGs into client.template.js and write the single-file
// client.js that DSH's ModuleLoader serves. `--check` compares without writing.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const template = readFileSync(join(root, 'client.template.js'), 'utf8')
const marker = '/*__AVATAR_DATA__*/ null'
if (!template.includes(marker)) throw new Error(`avatar marker missing from client.template.js`)

const avatars = {}
for (const file of readdirSync(join(root, 'avatars')).sort()) {
  if (!file.endsWith('.png')) continue
  const bytes = readFileSync(join(root, 'avatars', file))
  // The shipped avatars are JPEG bytes with a .png name; pick the MIME from the magic.
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'application/octet-stream'
  avatars[file.slice(0, -4)] = `data:${mime};base64,${bytes.toString('base64')}`
}
for (const type of ['lead', 'research', 'code', 'write', 'data', 'qa']) {
  if (!avatars[type]) throw new Error(`missing avatar: ${type}.png`)
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

#!/usr/bin/env node
/**
 * HTTP-level self test for the mock provider: success, SSE streaming, 429/500
 * injection, replay and recording. No DSH, no browser, no model call.
 *
 *   node e2e/mock-provider/self-test.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'dsh-mock-provider-'))
const record = join(dir, 'requests.jsonl')

const start = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, 'server.mjs'), ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
      const m = out.match(/MOCK_PROVIDER_URL=(\S+)/)
      if (m) resolve({ child, url: m[1] })
    })
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)))
    setTimeout(() => reject(new Error('server start timeout')), 10_000)
  })
const stop = (child) => new Promise((r) => (child.on('exit', r), child.kill('SIGTERM')))
const chat = (url, prompt, stream = true) =>
  fetch(url + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'mock-echo', stream, messages: [{ role: 'user', content: prompt }] }),
  })

const assert = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) process.exitCode = 1
}

const { child, url } = await start(['--record', record])

const models = await (await fetch(url + '/models')).json()
assert(models.data?.[0]?.id === 'mock-echo', 'GET /v1/models lists mock-echo')

const plain = await chat(url, '直接回答：1+1 等于几？')
const plainText = await plain.text()
assert(plain.status === 200 && /"content":"2"/.test(plainText), 'non-stream: 1+1 -> 2')

const streamed = await chat(url, '请回复一句话')
const streamText = await streamed.text()
assert(streamed.status === 200 && /MOCK_OK:/.test(streamText) && streamText.includes('[DONE]'), 'stream: SSE chunks + [DONE]')

const limited = await chat(url, '触发限流 [[MOCK_ERROR_429]]')
assert(limited.status === 429, 'error injection: 429')
const broken = await chat(url, '触发故障 [[MOCK_ERROR_500]]')
assert(broken.status === 500, 'error injection: 500')

await stop(child)
const recorded = readFileSync(record, 'utf8').trim().split('\n')
assert(recorded.length >= 4, `record: ${recorded.length} request/response pairs`)
assert(!recorded.join('').includes('authorization'), 'record: never stores Authorization')

const replayRun = await start(['--replay', record])
const replayed = await chat(replayRun.url, '直接回答：1+1 等于几？')
assert(replayed.status === 200 && /"content":"2"/.test(await replayed.text()), 'replay: recorded answer served without a provider')
await stop(replayRun.child)

console.log(process.exitCode ? 'RESULT: FAIL' : 'RESULT: PASS')

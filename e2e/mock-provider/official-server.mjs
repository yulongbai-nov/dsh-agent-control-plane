#!/usr/bin/env node
/**
 * Launcher for the OFFICIAL DeepSeek mock server (@deepseek-ai/dsh-llm-mock-server).
 *
 * It serves the Messages protocol (`POST /v1/messages`) with a scripted
 * behaviour sequence, so DSH's default `deepseek-official` adapter can be
 * pointed at it via `$DEEPSEEK_BASE_URL` — no provider key, no network.
 *
 *   node e2e/mock-provider/official-server.mjs [--port 0] [--record <file.jsonl>]
 *
 * Prints one line: `MOCK_PROVIDER_URL=http://127.0.0.1:<port>/v1`.
 * Captured requests (body/behavior/outcome, never headers) are written to
 * `--record` after every accepted request and again on shutdown.
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const PORT = Number(flag('--port', '0'))
const RECORD = flag('--record', null)
const INITIAL_SEQUENCE = flag('--sequence', 'success').split(',').map((s) => s.trim()).filter(Boolean)

const SUCCESS_TEXT = 'MOCK_OK:official mock provider'
let currentServer = null
const start = (sequence) =>
  startMockLlmServer({
    host: '127.0.0.1',
    port: PORT,
    // One deterministic behavior per request; repeat so scripted faults never exhaust.
    sequence,
    repeatLast: true,
    successText: SUCCESS_TEXT,
    onEvent: () => {
      // Keep the capture fresh for assertions running while DSH is alive.
      if (currentServer) flush()
    },
  })

let server = await start(INITIAL_SEQUENCE.length ? INITIAL_SEQUENCE : ['success'])
currentServer = server
const mockPort = server.port

let written = 0
const flush = () => {
  if (!RECORD) return
  try {
    // Rewrite the whole capture atomically-ish; request count is tiny here.
    writeFileSync(
      RECORD,
      server.requests
        .map((record) => JSON.stringify({ attempt: record.attempt, behavior: record.behavior, outcome: record.outcome, body: record.body }))
        .join('\n') + (server.requests.length ? '\n' : ''),
    )
    written = server.requests.length
  } catch {}
}

// --- control plane for per-test fault sequences (same port, swapped script) ---------------
// A test can POST /sequence to change what the next accepted requests do without
// restarting DSH (whose base URL is fixed at launch).
let sequence = ['success']
const restart = async (nextSequence) => {
  flush()
  await server.close()
  let lastError
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      server = await start(nextSequence)
      currentServer = server
      sequence = nextSequence
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw lastError
}

const control = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ sequence, requests: server.requests.length }))
    return
  }
  if (req.method === 'POST' && url.pathname === '/sequence') {
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        const next = Array.isArray(body.sequence) && body.sequence.length ? body.sequence : ['success']
        await restart(next)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, sequence: next }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
      }
    })
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'not found' }))
})
control.listen(0, '127.0.0.1', () => {
  // Print both lines only after the control endpoint is live, so a caller that
  // parses stdout never races the sequence API.
  console.log(`MOCK_CONTROL_URL=http://127.0.0.1:${control.address().port}`)
  console.log(`MOCK_PROVIDER_URL=${server.baseURL}/v1`)
})

// Keep the capture fresh enough for assertions that run while DSH is alive.
const timer = setInterval(() => {
  if (server.requests.length !== written) flush()
}, 200)
timer.unref()

const shutdown = async () => {
  clearInterval(timer)
  flush()
  try {
    control.close()
  } catch {}
  try {
    await server.close()
  } catch {}
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('exit', () => {
  try {
    flush()
  } catch {}
})

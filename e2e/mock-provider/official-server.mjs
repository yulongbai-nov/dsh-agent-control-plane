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
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const PORT = Number(flag('--port', '0'))
const RECORD = flag('--record', null)

const server = await startMockLlmServer({
  host: '127.0.0.1',
  port: PORT,
  // One deterministic success per request; repeat so retries never exhaust the script.
  sequence: ['success'],
  repeatLast: true,
  successText: 'MOCK_OK:official mock provider',
})

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

console.log(`MOCK_PROVIDER_URL=${server.baseURL}/v1`)

// Keep the capture fresh enough for assertions that run while DSH is alive.
const timer = setInterval(() => {
  if (server.requests.length !== written) flush()
}, 200)
timer.unref()

const shutdown = async () => {
  clearInterval(timer)
  flush()
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

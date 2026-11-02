#!/usr/bin/env node
/**
 * Deterministic OpenAI-compatible mock provider for DSH E2E / CI.
 *
 *   node e2e/mock-provider/server.mjs [--port 0] [--record <file.jsonl>] [--replay <file.jsonl>]
 *
 * It prints one line `MOCK_PROVIDER_URL=http://127.0.0.1:<port>/v1` on stdout and
 * serves:
 *   GET  /v1/models            -> one model, `mock-echo`
 *   POST /v1/chat/completions  -> deterministic text (or an injected failure)
 *
 * Scenario markers in the last user message drive behaviour, so a prompt alone
 * can select a failure case without any test-side plumbing:
 *   [[MOCK_ERROR_429]]  -> HTTP 429 rate-limit error
 *   [[MOCK_ERROR_500]]  -> HTTP 500 server error
 *   [[MOCK_TIMEOUT]]    -> never answers (client timeout path)
 *   [[MOCK_STOP]]       -> finish_reason "stop" with an empty body
 *   otherwise           -> "MOCK_OK:<echo of the prompt>"; "1+1" answers "2"
 *
 * `--record` appends every request/response pair as JSONL (Authorization is
 * never recorded). `--replay` answers a request whose hash matches a recorded
 * one with the recorded response, which makes real-model traffic replayable in
 * CI without spending a model call.
 */
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const PORT = Number(flag('--port', '0'))
const RECORD = flag('--record', null)
const REPLAY = flag('--replay', null)

const replay = new Map()
if (REPLAY) {
  for (const line of (await import('node:fs')).readFileSync(REPLAY, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.hash && entry.response) replay.set(entry.hash, entry.response)
    } catch {}
  }
}

const textOf = (body) => {
  // DSH appends runtime context as a later user message, so scan every user
  // message (and every content part) instead of only the last one.
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const parts = []
  for (const message of messages) {
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') parts.push(message.content)
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (typeof part === 'string') parts.push(part)
        else if (typeof part?.text === 'string') parts.push(part.text)
      }
    }
  }
  return parts.join('\n')
}
const scenarioOf = (text) =>
  /\[\[MOCK_ERROR_429\]\]/.test(text)
    ? '429'
    : /\[\[MOCK_ERROR_500\]\]/.test(text)
      ? '500'
      : /\[\[MOCK_TIMEOUT\]\]/.test(text)
        ? 'timeout'
        : /\[\[MOCK_STOP\]\]/.test(text)
          ? 'stop'
          : 'text'
const replyOf = (text) => {
  if (/1\+1/.test(text)) return '2'
  return `MOCK_OK:${text.replace(/\s+/g, ' ').trim().slice(0, 80)}`
}
const hashOf = (body) =>
  createHash('sha256')
    .update(JSON.stringify({ model: body?.model, messages: body?.messages, tools: body?.tools?.map((t) => t?.function?.name) }))
    .digest('hex')

const sse = (res, id, model, chunks) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-echo', object: 'model', owned_by: 'dsh-control-plane-e2e' }] }))
    return
  }
  if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'not found', type: 'invalid_request_error' } }))
    return
  }
  let raw = ''
  req.on('data', (d) => (raw += d))
  req.on('end', () => {
    let body = {}
    try {
      body = JSON.parse(raw || '{}')
    } catch {}
    const text = textOf(body)
    const scenario = scenarioOf(text)
    const hash = hashOf(body)
    const id = `mockcmpl-${hash.slice(0, 12)}`
    const model = body?.model || 'mock-echo'
    const recorded = replay.get(hash)
    const content = recorded?.content ?? (scenario === 'text' ? replyOf(text) : '')

    const finish = () => {
      if (RECORD) {
        appendFileSync(
          RECORD,
          JSON.stringify({ at: new Date().toISOString(), hash, model, scenario, prompt: text.slice(0, 5000), response: { content } }) + '\n',
        )
      }
    }

    if (scenario === '429') {
      finish()
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'mock rate limit', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }))
      return
    }
    if (scenario === '500') {
      finish()
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'mock server error', type: 'server_error' } }))
      return
    }
    if (scenario === 'timeout') {
      finish()
      setTimeout(() => {
        try {
          res.writeHead(504, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'mock timeout', type: 'timeout' } }))
        } catch {}
      }, 30_000)
      return
    }
    finish()
    if (body?.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      )
      return
    }
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model }
    const chunks = []
    for (const part of content.match(/.{1,16}/gs) ?? ['']) {
      chunks.push({ ...base, choices: [{ index: 0, delta: { content: part }, finish_reason: null }] })
    }
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    sse(res, id, model, chunks)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  const address = server.address()
  console.log(`MOCK_PROVIDER_URL=http://127.0.0.1:${address.port}/v1`)
  if (RECORD) console.log(`MOCK_PROVIDER_RECORD=${RECORD}`)
  if (REPLAY) console.log(`MOCK_PROVIDER_REPLAY=${REPLAY} entries=${replay.size}`)
})

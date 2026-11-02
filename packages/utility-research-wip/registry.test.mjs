import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSyntheticUtilityRegistry } from './registry.mjs'

test('manual promotion, pinned version, rollback and disable', async () => {
  let consent = false, calls = 0
  const registry = createSyntheticUtilityRegistry(new Map([
    ['demo@1', s => { calls++; return `v1:${s}` }], ['demo@2', s => `v2:${s}`],
  ]), async () => consent)
  await assert.rejects(registry.promote('demo', 1), /NOT_CONFIRMED/)
  await assert.rejects(registry.run_utility({ id:'demo', version:1, input:'x', requestId:'r1' }), /NOT_ENABLED/)
  consent = true; await registry.promote('demo', 1)
  const run = () => registry.run_utility({ id:'demo', version:1, input:'x', requestId:'r1' })
  assert.deepEqual(await Promise.all([run(), run()]), ['v1:x','v1:x']); assert.equal(calls,1)
  await assert.rejects(registry.run_utility({ id:'demo', version:1, input:'y', requestId:'r1' }), /IDEMPOTENCY_CONFLICT/)
  await registry.promote('demo', 2)
  await assert.rejects(run(), /NOT_ENABLED/)
  await registry.promote('demo', 1)
  assert.equal(await run(), 'v1:x'); registry.disable('demo')
  await assert.rejects(run(), /NOT_ENABLED/)
  await assert.rejects(registry.promote('demo', 3), /UNKNOWN_VERSION/)
})

test('invalid inputs fail before dispatch', async () => {
  let calls = 0
  const r = createSyntheticUtilityRegistry(new Map([['demo@1', () => ++calls]]), () => true)
  await r.promote('demo',1)
  await assert.rejects(r.run_utility({ id:'demo', version:1, input:'x'.repeat(1025), requestId:'r' }), /INVALID_INPUT/)
  assert.equal(calls,0)
})

test('disable invalidates an in-flight confirmation', async () => {
  let resolve
  const r = createSyntheticUtilityRegistry(new Map([['demo@1', x => x]]), () => new Promise(r => { resolve = r }))
  const pending = r.promote('demo',1)
  r.disable('demo'); resolve(true)
  await assert.rejects(pending, /STALE_CONFIRMATION/)
  await assert.rejects(r.run_utility({id:'demo',version:1,input:'x',requestId:'r'}), /NOT_ENABLED/)
})

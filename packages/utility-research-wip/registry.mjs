// Synthetic fixture only. No native Host registration or untrusted execution.
export function createSyntheticUtilityRegistry(fixtures, confirm) {
  if (!(fixtures instanceof Map) || typeof confirm !== 'function') throw Error('INVALID_SETUP')
  const approved = new Map(), enabled = new Map(), executions = new Map(), revisions = new Map()
  const idPattern = /^[a-z][a-z0-9_-]{0,63}$/
  const keyOf = (id, version) => `${id}@${version}`
  const valid = (id, version) => typeof id === 'string' && idPattern.test(id) && Number.isSafeInteger(version) && version > 0
  async function promote(id, version) {
    if (!valid(id, version)) throw Error('INVALID_INPUT')
    const key = keyOf(id, version)
    if (!fixtures.has(key) || typeof fixtures.get(key) !== 'function') throw Error('UNKNOWN_VERSION')
    const fixture = fixtures.get(key)
    const revision = (revisions.get(id) ?? 0) + 1
    revisions.set(id, revision)
    // The confirmation callback is a trusted harness capability, never model input.
    if (await confirm(Object.freeze({ id, version })) !== true) throw Error('NOT_CONFIRMED')
    if (revisions.get(id) !== revision) throw Error('STALE_CONFIRMATION')
    approved.set(key, fixture); enabled.set(id, version)
  }
  function disable(id) { if (typeof id !== 'string' || !idPattern.test(id)) throw Error('INVALID_INPUT'); revisions.set(id, (revisions.get(id) ?? 0) + 1); enabled.delete(id) }
  async function run_utility({ id, version, input, requestId }) {
    if (!valid(id, version) || typeof requestId !== 'string' || !idPattern.test(requestId) || typeof input !== 'string' || input.length > 1024) throw Error('INVALID_INPUT')
    const key = keyOf(id, version)
    if (enabled.get(id) !== version || !approved.has(key)) throw Error('NOT_ENABLED')
    const previous = executions.get(requestId)
    if (previous) {
      if (previous.key !== key || previous.input !== input) throw Error('IDEMPOTENCY_CONFLICT')
      return previous.result
    }
    // Capture before dispatch: repeating the same request observes the same
    // in-memory result, including rejection, and does not run a fixture twice.
    const result = Promise.resolve().then(() => approved.get(key)(input))
    executions.set(requestId, { key, input, result })
    return result
  }
  return Object.freeze({ promote, disable, run_utility })
}

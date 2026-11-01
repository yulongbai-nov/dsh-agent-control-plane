import { types } from 'node:util';

const LIMIT = 1_000_000;

export function snapshotMeta(value) {
  const seen = new Set();
  let budget = 65_536, nodes = 0;
  function copy(input, depth) {
    if (depth > 32 || ++nodes > 10_000) throw new Error('limit');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') { budget -= input.length; if (budget < 0) throw new Error('limit'); return input; }
    if (typeof input === 'number' && Number.isFinite(input) && !Object.is(input, -0)) return input;
    if (typeof input !== 'object' || types.isProxy(input) || seen.has(input)) throw new Error('unsupported');
    const array = Array.isArray(input);
    const proto = Object.getPrototypeOf(input);
    if (proto !== (array ? Array.prototype : Object.prototype) && proto !== null) throw new Error('prototype');
    seen.add(input);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
      if (!Number.isSafeInteger(length) || length > 1024) throw new Error('array limit');
      const keys = Reflect.ownKeys(input);
      if (keys.length !== length + 1 || keys.some((key) => typeof key !== 'string')) throw new Error('sparse or extra array key');
      const output = [];
      for (let i = 0; i < length; i++) {
        const property = Object.getOwnPropertyDescriptor(input, String(i));
        if (!property || !property.enumerable || !('value' in property)) throw new Error('sparse or accessor');
        output.push(copy(property.value, depth + 1));
      }
      seen.delete(input);
      return output;
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length > 1024 || keys.some((key) => typeof key !== 'string')) throw new Error('object limit or symbol');
    const output = Object.create(null);
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(input, key);
      if (!property.enumerable || !('value' in property) || key === 'toJSON') throw new Error('accessor');
      budget -= key.length;
      if (budget < 0) throw new Error('limit');
      Object.defineProperty(output, key, { value: copy(property.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    seen.delete(input);
    return output;
  }
  try {
    const result = copy(value, 0);
    return result !== null && !Array.isArray(result) && typeof result === 'object' ? result : undefined;
  } catch { return undefined; }
}

function roughTextSize(value) {
  if (typeof value === 'string') return value.length;
  if (value === null || typeof value !== 'object') return 16;
  let total = 2;
  if (Array.isArray(value)) {
    for (const item of value) total += roughTextSize(item) + 1;
  } else {
    for (const key of Object.keys(value)) total += key.length + roughTextSize(value[key]) + 4;
  }
  return total;
}

export function createCollector() {
  const records = [];
  let retained = 0;
  let active = true;
  return {
    publish({ sessionId, callId, rootCallId, runId, jobId, kind, request }) {
      try {
        if (!active) return;
        if (![sessionId, callId, rootCallId, runId].every((v) => typeof v === 'string' && v.length > 0 && v.length <= 1024)) return;
        if (kind !== 'foreground' && kind !== 'background') return;
        if (kind === 'background' && jobId !== undefined && (typeof jobId !== 'string' || !jobId || jobId.length > 1024)) return;
        if (request.meta === undefined || typeof request.script !== 'string' || request.script.length > LIMIT) return;
        const meta = snapshotMeta(request.meta);
        if (meta === undefined) return;
        const size = request.script.length + roughTextSize(meta);
        if (records.length >= 32 || size > LIMIT || retained + size > 2 * LIMIT) return;
        records.push({ status: 'unverified', sessionId, callId, rootCallId, runId, kind, ...(jobId === undefined ? {} : { jobId }), script: request.script, meta });
        retained += size;
      } catch {}
    },
    snapshot() { return structuredClone(records); },
    clear() { records.length = 0; retained = 0; },
    dispose() { active = false; records.length = 0; retained = 0; },
  };
}

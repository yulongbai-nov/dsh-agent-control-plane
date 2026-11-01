import { types } from 'node:util';

const BACKENDS = new Set(['spawn', 'fork', 'codex', 'claude-code', 'acp']);
const OPTION_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens', 'subagentDepth']);
const SPEC_KEYS = new Set(['preset', 'overrides']);
const finding = (level, code) => ({ level, code });
const reject = code => ({ status: 'reject', findings: [finding('reject', code)] });
const plain = object => {
  if (object === null || typeof object !== 'object' || types.isProxy(object)) return false;
  const prototype = Object.getPrototypeOf(object);
  return prototype === Object.prototype || prototype === null;
};
const keysAllowed = (keys, allowed) => keys.every(key => typeof key === 'string' && allowed.has(key));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

// This is static screening only. Runtime admission, authorization and availability are unknown.
export function checkAgentSpec(backend, spec) {
  try {
    if (!plain(spec)) return reject('UNSUPPORTED_SPEC_FIELD');
    const specKeys = Reflect.ownKeys(spec);
    if (!keysAllowed(specKeys, SPEC_KEYS)) return reject('UNSUPPORTED_SPEC_FIELD');
    const hasPreset = specKeys.includes('preset'), hasOverrides = specKeys.includes('overrides');
    const preset = hasPreset ? spec.preset : undefined;
    const overrides = hasOverrides ? spec.overrides : undefined;
    if (hasPreset && !nonempty(preset)) return reject('INVALID_AGENT_PRESET');

    let optionKeys = [];
    if (hasOverrides) {
      if (!plain(overrides)) return reject('UNSUPPORTED_AGENT_OPTIONS');
      optionKeys = Reflect.ownKeys(overrides);
      if (!keysAllowed(optionKeys, OPTION_KEYS)) return reject('UNSUPPORTED_AGENT_OPTIONS');
    }
    const agentOptions = {};
    if (hasOverrides) {
      if (optionKeys.includes('subagentDepth')) return reject('RUNTIME_OWNED_SUBAGENT_DEPTH');
      for (const key of optionKeys) {
        const value = overrides[key];
        if (key === 'maxTokens' ? !Number.isSafeInteger(value) || value <= 0 : !nonempty(value)) return reject('INVALID_AGENT_OPTION');
        agentOptions[key] = value;
      }
    }
    if (typeof backend !== 'string' || !BACKENDS.has(backend)) {
      return { status: 'unknown', findings: [finding('unknown', 'UNKNOWN_BACKEND')] };
    }
    if (hasPreset && backend !== 'spawn') return reject('UNSUPPORTED_AGENT_PRESET');
    if (hasOverrides && backend !== 'spawn' && backend !== 'fork') return reject('UNSUPPORTED_AGENT_OPTIONS');
    const approved = {};
    if (hasPreset) approved.agentPreset = preset;
    if (hasOverrides) approved.agentOptions = agentOptions;
    return { status: 'unknown', approved, findings: [finding('unknown', 'RUNTIME_NOT_VERIFIED'), finding('unknown', 'DELEGATION_POLICY_UNKNOWN')] };
  } catch {
    return reject('UNREADABLE_INPUT');
  }
}

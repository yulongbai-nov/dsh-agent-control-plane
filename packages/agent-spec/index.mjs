const BACKENDS = new Set(['spawn', 'fork', 'codex', 'claude-code', 'acp']);
const OPTION_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens', 'subagentDepth']);
const SPEC_KEYS = new Set(['preset', 'overrides']);
const finding = (level, code) => ({ level, code });
const reject = code => ({ status: 'reject', findings: [finding('reject', code)] });
const plain = object => object !== null && typeof object === 'object' &&
  (Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null);
const keysAllowed = (object, allowed) => Reflect.ownKeys(object).every(key => typeof key === 'string' && allowed.has(key));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

// This is static screening only. Runtime admission, authorization and availability are unknown.
export function checkAgentSpec(backend, spec) {
  try {
    if (!plain(spec) || !keysAllowed(spec, SPEC_KEYS)) return reject('UNSUPPORTED_SPEC_FIELD');
    const hasPreset = Object.hasOwn(spec, 'preset'), hasOverrides = Object.hasOwn(spec, 'overrides');
    const preset = hasPreset ? spec.preset : undefined;
    const overrides = hasOverrides ? spec.overrides : undefined;
    if (hasPreset && !nonempty(preset)) return reject('INVALID_AGENT_PRESET');
    if (hasOverrides && (!plain(overrides) || !keysAllowed(overrides, OPTION_KEYS))) return reject('UNSUPPORTED_AGENT_OPTIONS');

    const agentOptions = {};
    if (hasOverrides) {
      if (Object.hasOwn(overrides, 'subagentDepth')) return reject('RUNTIME_OWNED_SUBAGENT_DEPTH');
      for (const key of Reflect.ownKeys(overrides)) {
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

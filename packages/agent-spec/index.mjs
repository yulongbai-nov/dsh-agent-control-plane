import { types } from 'node:util';

const BACKENDS = new Set(['spawn', 'fork', 'codex', 'claude-code', 'acp']);
const OPTION_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens', 'subagentDepth']);
const SPEC_KEYS = new Set(['preset', 'overrides']);
const finding = (level, code) => ({ level, code });
const reject = code => ({ status: 'reject', findings: [finding('reject', code)] });
// Prototype equality alone cannot distinguish e.g. a Map with a replaced
// prototype. Reject the exotic brands Node exposes, before reflection.
const EXOTIC_CHECKS = [
  Array.isArray, types.isArgumentsObject, types.isAnyArrayBuffer, types.isArrayBufferView,
  types.isBoxedPrimitive, types.isDate, types.isExternal, types.isGeneratorObject,
  types.isMap, types.isSet, types.isWeakMap, types.isWeakSet, types.isMapIterator, types.isSetIterator,
  types.isModuleNamespaceObject, types.isNativeError, types.isPromise, types.isRegExp,
  types.isCryptoKey, types.isKeyObject,
];
const plain = object => {
  if (object === null || typeof object !== 'object' || types.isProxy(object)) return false;
  if (EXOTIC_CHECKS.some(isExotic => isExotic(object))) return false;
  const prototype = Object.getPrototypeOf(object);
  return prototype === Object.prototype || prototype === null;
};
// Descriptor objects inherit Object.prototype: do not pass them directly to
// Object.defineProperty, whose ToPropertyDescriptor reads inherited fields.
const defineData = (object, key, value) => Object.defineProperty(object, key,
  { __proto__: null, value, writable: true, enumerable: true, configurable: true });
const hasOwn = (object, key) => Object.hasOwn(object, key);
const snapshotData = (object, allowed) => {
  if (!plain(object)) return null;
  const keys = Reflect.ownKeys(object);
  if (keys.length > allowed.size) return null;
  const data = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.has(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
    defineData(data, key, descriptor.value);
  }
  return data;
};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

// This is static screening only. Runtime admission, authorization and availability are unknown.
export function checkAgentSpec(backend, spec) {
  try {
    const specData = snapshotData(spec, SPEC_KEYS);
    if (specData === null) return reject('UNSUPPORTED_SPEC_FIELD');
    const hasPreset = hasOwn(specData, 'preset'), hasOverrides = hasOwn(specData, 'overrides');
    const preset = hasPreset ? specData.preset : undefined;
    const overrides = hasOverrides ? specData.overrides : undefined;
    if (hasPreset && !nonempty(preset)) return reject('INVALID_AGENT_PRESET');

    const optionData = hasOverrides ? snapshotData(overrides, OPTION_KEYS) : null;
    if (hasOverrides && optionData === null) return reject('UNSUPPORTED_AGENT_OPTIONS');
    const agentOptions = {};
    if (hasOverrides) {
      if (hasOwn(optionData, 'subagentDepth')) return reject('RUNTIME_OWNED_SUBAGENT_DEPTH');
      for (const key of Object.keys(optionData)) {
        const value = optionData[key];
        if (key === 'maxTokens' ? !Number.isSafeInteger(value) || value <= 0 : !nonempty(value)) return reject('INVALID_AGENT_OPTION');
        defineData(agentOptions, key, value);
      }
    }
    if (typeof backend !== 'string' || !BACKENDS.has(backend)) {
      return { status: 'unknown', findings: [finding('unknown', 'UNKNOWN_BACKEND')] };
    }
    if (hasPreset && backend !== 'spawn') return reject('UNSUPPORTED_AGENT_PRESET');
    if (hasOverrides && backend !== 'spawn' && backend !== 'fork') return reject('UNSUPPORTED_AGENT_OPTIONS');
    const approved = {};
    if (hasPreset) defineData(approved, 'agentPreset', preset);
    if (hasOverrides) defineData(approved, 'agentOptions', agentOptions);
    return { status: 'unknown', approved, findings: [finding('unknown', 'RUNTIME_NOT_VERIFIED'), finding('unknown', 'DELEGATION_POLICY_UNKNOWN')] };
  } catch {
    return reject('UNREADABLE_INPUT');
  }
}

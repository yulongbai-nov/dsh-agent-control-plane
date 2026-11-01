'use strict';

// rc.5's result event proves neither tool identity nor the origin of its final value.
const { createHash } = require('node:crypto');
const POISONED = Symbol('conflicting observation');
const MAX_TEXT = 1_000_000;
const MAX_ID = 1024;
const MAX_PHASES = 1024;
const text = value => typeof value === 'string' && value.length <= MAX_ID && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function snapshot(exec, result, toolName) {
  if (!object(exec) || exec.name !== toolName) return;
  const sessionId = exec.agent?.session?.id, toolCallId = exec.callId;
  if (!text(sessionId) || !text(toolCallId)) return;
  const identity = { sessionId, toolCallId };
  try {
    const runId = result?.value?.runId;
    if (text(runId)) identity.runId = runId;
    if (exec.parent !== undefined || exec.rootCallId !== toolCallId || !(exec.signal instanceof AbortSignal) || exec.signal.aborted !== false ||
        result?.isError !== false || !object(result.value) || result.value.kind !== 'foreground' || !text(runId) ||
        !Number.isSafeInteger(result.value.agentsStarted) || result.value.agentsStarted < 0 || !own(result.value, 'result')) return {identity};
    const args = exec.arguments, meta = args?.meta;
    if (!object(args) || typeof args.script !== 'string' || args.script.length > MAX_TEXT || !object(meta) ||
        typeof meta.name !== 'string' || typeof meta.description !== 'string' ||
        (args.run_in_background !== undefined && args.run_in_background !== false)) return {identity};
    // shortcut: rc.5 already snapshots JSON before emission; re-audit this assumption on upgrade.
    const serializedMeta = JSON.stringify(meta);
    if (typeof serializedMeta !== 'string' || serializedMeta.length > MAX_TEXT) return {identity};
    const metaHash = createHash('sha256').update(serializedMeta).digest('hex');
    let length = meta.name.length + meta.description.length;
    const copiedMeta = {name:meta.name, description:meta.description};
    if (own(meta, 'phases')) {
      if (!Array.isArray(meta.phases) || meta.phases.length > MAX_PHASES) return {identity};
      copiedMeta.phases = [];
      for (const phase of meta.phases) {
        if (!object(phase) || typeof phase.title !== 'string') return {identity};
        length += phase.title.length;
        if (length > MAX_TEXT) return {identity};
        copiedMeta.phases.push({title:phase.title});
      }
    }
    if (args.script.length + length > MAX_TEXT) return {identity};
    return {identity, metaHash, candidate:{status:'unverified', toolName, sessionId, toolCallId, runId, script:args.script, meta:copiedMeta}};
  } catch { return {identity}; }
}

function createSourceObserver({toolName, maxEntries = 256} = {}) {
  if (!text(toolName) || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
    throw new TypeError('toolName and a maxEntries between 1 and 10000 are required');
  }
  const sessions = new Map();
  let keys = 0, disabled = false;
  function observe(exec, result) {
    try {
      if (disabled) return;
      const observation = snapshot(exec, result, toolName);
      if (!observation) return;
      const {identity, candidate, metaHash} = observation;
      const {sessionId, toolCallId, runId} = identity;
      let session = sessions.get(sessionId);
      if (!session) {
        if (!candidate) return;
        session = {calls:new Map(), runs:new Map()};
        sessions.set(sessionId, session);
      }
      const {calls, runs} = session;
      const previousCall = calls.get(toolCallId), previousRun = runId === undefined ? undefined : runs.get(runId);
      // Invalid isolated results are dropped; contradictory observations revoke known candidates.
      if (!candidate && previousCall === undefined && previousRun === undefined) return;
      const added = Number(!calls.has(toolCallId)) + Number(runId !== undefined && !runs.has(runId));
      if (keys + added > maxEntries * 2) { disabled = true; sessions.clear(); return; }
      keys += added;
      const same = candidate && previousCall !== undefined && previousCall === previousRun && previousCall !== POISONED &&
        previousCall.metaHash === metaHash && JSON.stringify(previousCall.candidate) === JSON.stringify(candidate);
      if (same) return;
      if (!candidate || previousCall !== undefined || previousRun !== undefined) {
        for (const prior of [previousCall, previousRun]) if (prior && prior !== POISONED) {
          calls.set(prior.candidate.toolCallId, POISONED);
          runs.set(prior.candidate.runId, POISONED);
        }
        calls.set(toolCallId, POISONED);
        if (runId !== undefined) runs.set(runId, POISONED);
        return;
      }
      const entry = {candidate, metaHash};
      calls.set(toolCallId, entry);
      runs.set(runId, entry);
    } catch {
      // A bad observation must not throw into tool execution; no asynchronous work here.
    }
  }
  function get(sessionId, runId) {
    if (disabled || !text(sessionId) || !text(runId)) return;
    const candidate = sessions.get(sessionId)?.runs.get(runId);
    if (!candidate || candidate === POISONED) return;
    return JSON.parse(JSON.stringify(candidate.candidate));
  }
  function clear() { sessions.clear(); keys = 0; disabled = false; }
  return Object.freeze({observe, get, clear});
}

function attachSourceObserver(ctx, observer) {
  if (!ctx || typeof ctx.on !== 'function' || !observer || typeof observer.observe !== 'function') throw new TypeError('ctx and observer are required');
  let active = true;
  const off = ctx.on('tools/result', (exec, result) => {
    if (active) try { observer.observe(exec, result); } catch { /* observe only */ }
  });
  return () => { active = false; if (typeof off === 'function') off(); };
}

// Only this captured source is parsed; result-event data alone is never proof.
function projectObservedWorkflow({observer, sessionId, runId, events, extractTopology, layoutTopology, projectWorkflow} = {}) {
  const candidate = observer?.get(sessionId, runId);
  if (!candidate) return;
  const topology = extractTopology(candidate.script, candidate.meta);
  const layout = layoutTopology(topology);
  if (JSON.stringify(observer.get(sessionId, runId)) !== JSON.stringify(candidate)) return;
  return projectWorkflow({runId, parentSessionId:sessionId, topology, layout, events,
    sourceBinding:{status:'unverified', runId, toolCallId:candidate.toolCallId}});
}

module.exports = {createSourceObserver, attachSourceObserver, projectObservedWorkflow};

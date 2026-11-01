'use strict';

const PREFIX = 'tool-workflow/';
const TYPES = new Set(['run-start', 'run-end', 'agent-start', 'agent-end']);
const OUTCOMES = new Set(['completed', 'failed', 'cancelled']);
const REASONS = new Map([['completed', 'completed'], ['error', 'failed'], ['cancelled', 'cancelled']]);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const validSeq = (value) => Number.isSafeInteger(value) && value >= 1;
const text = (value) => typeof value === 'string';

// The inputs are session-log data and a trusted static skeleton, not executable code.
function projectWorkflow({ runId, topology, layout, events, parentSessionId, sourceBinding } = {}) {
  if (!text(runId) || !runId || !topology || !Array.isArray(topology.nodes) || !layout || !Array.isArray(events)) {
    throw new TypeError('runId, topology, layout and events are required');
  }
  if (parentSessionId !== undefined && (!text(parentSessionId) || !parentSessionId)) throw new TypeError('parentSessionId must be a non-empty string');
  const diagnostics = [];
  const sourceVerified = sourceBinding?.status === 'verified' && sourceBinding.runId === runId && text(sourceBinding.toolCallId) && !!sourceBinding.toolCallId;
  const sourceStatus = sourceVerified ? 'verified' : 'unverified';
  const observed = [];
  const entries = new Map();
  let runStart;
  let runEnd;
  let runConflict = false;
  let malformed = false;
  let lastEventSeq = -1;
  for (const event of events) {
    if (!event || !text(event.type) || !event.type.startsWith(PREFIX) || !TYPES.has(event.type.slice(PREFIX.length))) continue;
    const data = event.data;
    if (!data || typeof data !== 'object' || !text(data.runId) || !data.runId) {
      malformed = true;
      runConflict = true;
      diagnostics.push({code:'INVALID_RUN_ID'});
      continue;
    }
    if (data.runId !== runId) continue;
    const kind = event.type.slice(PREFIX.length);
    if (Number.isSafeInteger(event.seq) && event.seq >= 0) {
      if (event.seq <= lastEventSeq) { malformed = true; runConflict = true; diagnostics.push({code:'INVALID_EVENT_ORDER'}); }
      lastEventSeq = event.seq;
    }
    if (runEnd) { malformed = true; runConflict = true; diagnostics.push({code:'INVALID_RUN_ORDER'}); }
    const summary = { type: event.type, runId };
    if (Number.isSafeInteger(event.seq) && event.seq >= 0) summary.eventSeq = event.seq;
    if (Number.isSafeInteger(event.time) && event.time >= 0) summary.time = event.time;
    if (own(data, 'seq') && validSeq(data.seq)) summary.seq = data.seq;
    if (text(data.label)) summary.label = data.label;
    if (text(data.phase)) summary.phase = data.phase;
    if (text(data.childId)) summary.childId = data.childId;
    if (text(data.outcome)) summary.outcome = data.outcome;
    if (text(data.name)) summary.name = data.name;
    if (text(data.stopReason)) summary.stopReason = data.stopReason;
    observed.push(summary);
    if (kind === 'run-start') {
      if (entries.size) { malformed = true; runConflict = true; diagnostics.push({code:'INVALID_RUN_ORDER'}); }
      if (!text(data.name) || runStart) { runConflict = true; diagnostics.push({code:'CONFLICTING_RUN_START'}); }
      else runStart = {name:data.name};
    } else if (kind === 'run-end') {
      if (!REASONS.has(data.stopReason) || runEnd) { runConflict = true; diagnostics.push({code:'CONFLICTING_RUN_END'}); }
      else runEnd = {status:REASONS.get(data.stopReason)};
    } else {
      if (!validSeq(data.seq)) {
        malformed = true;
        diagnostics.push({code:'INVALID_AGENT_SEQ'});
        continue;
      }
      let entry = entries.get(data.seq);
      if (!entry) { entry = {seq:data.seq, starts:[], ends:[]}; entries.set(data.seq,entry); }
      if (kind === 'agent-start') {
        if (entry.ends.length) { entry.invalid = true; diagnostics.push({code:'AGENT_END_BEFORE_START',seq:data.seq}); }
        if (!text(data.label) || !text(data.childId) || !data.childId || (own(data,'phase') && !text(data.phase))) {
          malformed = true;
          entry.invalid = true;
          diagnostics.push({code:'INVALID_AGENT_START',seq:data.seq});
        } else entry.starts.push({label:data.label, ...(own(data,'phase') ? {phase:data.phase} : {}),childId:data.childId});
      } else {
        if (!OUTCOMES.has(data.outcome)) {
          entry.invalid = true;
          diagnostics.push({code:'INVALID_AGENT_END',seq:data.seq});
        } else entry.ends.push(data.outcome);
      }
    }
  }
  const run = { ...(runStart ? {name:runStart.name} : {}), status: !runConflict && runEnd ? runEnd.status : 'unknown' };
  const invocations = [...entries.values()].sort((a,b) => a.seq-b.seq).map((entry) => {
    const first = entry.starts[0];
    const status = entry.invalid || entry.ends.length !== 1 ? 'unknown' : entry.ends[0];
    return {
      seq:entry.seq,
      ...(first ? first : {}),
      status,
      ...(entry.invalid || entry.starts.length > 1 || entry.ends.length > 1 ? {reason:'conflicting-seq'} : !first ? {reason:'missing-start'} : {}),
    };
  });
  const statusByNode = {};
  const unmatched = [];
  const missingStart = invocations.some((entry) => entry.reason === 'missing-start');
  const children = new Set();
  const duplicateChildren = new Set();
  for (const member of invocations) if (member.childId) {
    if (children.has(member.childId)) duplicateChildren.add(member.childId);
    children.add(member.childId);
  }
  if (duplicateChildren.size) diagnostics.push({code:'DUPLICATE_CHILD_ID'});
  const idCounts = new Map();
  for (const node of topology.nodes) if (node && text(node.id)) idCounts.set(node.id,(idCounts.get(node.id) || 0)+1);
  const candidates = (member) => topology.nodes.filter((node) => {
    if (!node || node.kind !== 'agent') return false;
    if (node.label !== null && node.label !== undefined && node.label !== member.label) return false;
    if (node.phase !== null && node.phase !== undefined && node.phase !== member.phase) return false;
    return true;
  });
  const optionsBySeq = new Map();
  for (const member of invocations) if (member.label !== undefined) optionsBySeq.set(member.seq,candidates(member));
  for (const member of invocations) {
    let reason = member.reason;
    const options = optionsBySeq.get(member.seq) || [];
    if (!reason && !sourceVerified) reason = 'source-unverified';
    if (!reason && (malformed || missingStart || duplicateChildren.has(member.childId))) reason = 'invalid-events';
    if (!reason && topology.complete !== true) reason = 'incomplete-topology';
    if (!reason && options.length === 0) reason = 'no-candidate';
    if (!reason && options.length > 1) reason = 'ambiguous-static';
    if (!reason && (!text(options[0].label) || (options[0].phase == null && member.phase !== undefined))) reason = 'ambiguous-static';
    if (!reason && (options[0].occurrence !== 'single' || !text(options[0].id))) reason = 'template';
    if (!reason && idCounts.get(options[0].id) !== 1) reason = 'ambiguous-static';
    if (!reason && invocations.some((other) => other.seq !== member.seq && (optionsBySeq.get(other.seq) || []).includes(options[0]))) reason = 'ambiguous-runtime';
    if (reason) unmatched.push({ ...member, reason });
    else Object.defineProperty(statusByNode, options[0].id, {value:member,enumerable:true,configurable:true,writable:true});
  }
  return {version:1,runId,sourceStatus,...(parentSessionId === undefined ? {} : {parentSessionId}),topology,layout,statusByNode,unmatched,events:observed,diagnostics,run};
}
module.exports = { projectWorkflow };

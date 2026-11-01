// Synthetic state machine only. This is not a DSH plugin or a production authorization boundary.
import { types } from 'node:util';
const internals = new WeakMap();
const nonempty = (value) => typeof value === 'string' && value.length <= 4096 && value.trim().length > 0;
const taskKeys = new Set(['id', 'revision', 'ownerId', 'status', 'subject']);
function snapshotTask(value) {
  try {
    if (value === null || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return;
    const keys = Reflect.ownKeys(value);
    if (keys.length > taskKeys.size || keys.some((key) => typeof key !== 'string' || !taskKeys.has(key))) return;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return;
      Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
    }
    return result;
  } catch { return; }
}
const token = () => Object.freeze(Object.create(null));
const validTask = (task) => task && nonempty(task.id) && Number.isSafeInteger(task.revision) && task.revision > 0 &&
  nonempty(task.subject) && ['pending', 'in_progress', 'completed', 'deleted'].includes(task.status) &&
  (task.ownerId === undefined || nonempty(task.ownerId));

export function createSyntheticHost() {
  const leads = new Map(), children = new Map(), leadState = new WeakMap(), childState = new WeakMap();
  let authorized = false, authorizationEpoch = 0;
  const host = Object.freeze({
    createLead(id) {
      if (!nonempty(id) || leads.has(id)) throw new Error('invalid or duplicate lead');
      const value = token(); leadState.set(value, { id, tasks: new Map(), high: 0, valid: true }); leads.set(id, value); return value;
    },
    disposeLead(lead) {
      const data = leadState.get(lead);
      if (data && leads.get(data.id) === lead) leads.delete(data.id);
    },
    createChild(id, lead) {
      const owner = leadState.get(lead);
      if (!nonempty(id) || children.has(id) || !owner || leads.get(owner.id) !== lead) throw new Error('invalid child');
      const value = token(); childState.set(value, { id, lead, title: undefined }); children.set(id, value); return value;
    },
    disposeChild(child) {
      const data = childState.get(child);
      if (data && children.get(data.id) === child) { children.delete(data.id); data.disposed = true; }
    },
    setAuthorized(value) { authorized = value === true; authorizationEpoch += 1; },
    task(lead, value) {
      const data = leadState.get(lead);
      if (!data || leads.get(data.id) !== lead) throw new Error('invalid lead');
      const task = snapshotTask(value);
      data.high += 1;
      if (!validTask(task)) { data.valid = false; return; }
      const old = data.tasks.get(task.id);
      if (task.revision !== (old?.revision ?? 0) + 1 || (!old && task.status !== 'pending')) { data.valid = false; return; }
      data.tasks.set(task.id, Object.freeze({ ...task, seq: data.high }));
    },
    title(child) {
      const data = childState.get(child);
      if (!data) throw new Error('foreign child');
      return data.title === undefined ? undefined : { ...data.title };
    },
    events(child) { if (!childState.has(child)) throw new Error('foreign child'); return []; },
  });
  internals.set(host, { leads, children, leadState, childState, authorized: () => authorized, authorizationEpoch: () => authorizationEpoch, owner: undefined });
  return host;
}

export function createModel(host, { generate = async ({ subject }) => subject } = {}) {
  const state = internals.get(host);
  if (!state || typeof generate !== 'function') throw new TypeError('synthetic host and generator required');
  if (state.owner !== undefined) throw new Error('synthetic title service already owned');
  const owner = Symbol('synthetic owner'); state.owner = owner;
  const work = new Map(), inFlight = new Set();
  let active = true, closePromise;
  const invalidateAttempt = (item) => {
    if (item.attempt?.status === 'pending') item.attempt.status = 'invalidated';
  };
  const supersede = (child, reason = 'task-change') => {
    let item = work.get(child);
    if (!item) { item = { revision: 0 }; work.set(child, item); }
    item.revision += 1;
    invalidateAttempt(item);
    if (reason !== 'task-change' && item.attempt) item.attempt.blocked = true;
    item.controller?.abort();
    item.controller = undefined;
    return item;
  };
  const alive = (lead, child) => {
    const parent = state.leadState.get(lead), data = state.childState.get(child);
    return active && parent && data && state.leads.get(parent.id) === lead && state.children.get(data.id) === child && data.lead === lead;
  };
  function observe(lead, cursor) {
    const parent = state.leadState.get(lead);
    if (!parent || state.leads.get(parent.id) !== lead || !active) return;
    const cut = cursor === undefined ? parent.high : cursor;
    const complete = state.authorized() && parent.valid && cut === parent.high;
    for (const child of state.children.values()) {
      const data = state.childState.get(child);
      if (data.lead !== lead) continue;
      // An incomplete observation invalidates pending task work, but not message work.
      if (!complete) {
        if (work.get(child)?.kind === 'task') supersede(child);
        continue;
      }
      const existing = work.get(child);
      const relevant = new Map([...parent.tasks.values()].filter((task) => task.ownerId === data.id).map((task) => [task.id, task]));
      const candidates = [...relevant.values()].filter((task) => task.status === 'in_progress');
      // A title candidate is one exact immutable task revision, not the whole task map.
      const task = candidates.length === 1 ? candidates[0] : undefined;
      const previousTask = existing?.selected;
      const changed = task !== previousTask;
      // Synthetic watermarks fence exact task versions that existed at message/invalidation time.
      const olderThanMessage = task !== undefined && task.seq <= (existing?.messageCut ?? -1);
      const explicitlyInvalidated = task !== undefined && (existing?.blockedLead === lead || task.seq <= (existing?.invalidationCut ?? -1));
      if (task === undefined || data.title?.kind === 'user' || olderThanMessage || explicitlyInvalidated) {
        if (existing) {
          if (existing.kind === 'task' && (changed || data.title?.kind === 'user' || olderThanMessage || explicitlyInvalidated)) supersede(child);
          existing.selected = task;
          if (changed) existing.attempt = undefined;
        }
        continue;
      }
      if (!changed && existing?.attempt?.status === 'pending' &&
          (existing.attempt.cut !== cut || existing.attempt.authorizationEpoch !== state.authorizationEpoch())) supersede(child);
      if (!changed && (!existing?.attempt || existing.attempt.status !== 'invalidated' || existing.attempt.blocked)) continue;
      if (!changed && existing.kind !== 'task') continue;
      const item = supersede(child), revision = item.revision;
      const authorizationEpoch = state.authorizationEpoch(), observedHigh = parent.high;
      const attempt = { status: 'pending', blocked: false, cut, authorizationEpoch };
      item.selected = task;
      item.attempt = attempt;
      item.kind = 'task';
      const controller = new AbortController(); item.controller = controller;
      const promise = Promise.resolve().then(async () => {
        if (!active || controller.signal.aborted || item.revision !== revision || !alive(lead, child) ||
            !state.authorized() || state.authorizationEpoch() !== authorizationEpoch || !parent.valid || cut !== parent.high || data.title?.kind === 'user') return;
        const title = await generate(Object.freeze({ subject: task.subject, taskId: task.id, revision: task.revision, signal: controller.signal }));
        // All checks and the synthetic state mutation below are synchronous; no callback or await may intervene.
        if (!active || controller.signal.aborted || item.revision !== revision || !alive(lead, child) || !state.authorized() ||
            state.authorizationEpoch() !== authorizationEpoch || !parent.valid || parent.high !== observedHigh || cut !== parent.high || data.title?.kind === 'user' ||
            parent.tasks.get(task.id) !== task || task.ownerId !== data.id || task.status !== 'in_progress' || !nonempty(title)) return;
        data.title = { kind: 'task', title: title.trim(), taskId: task.id, revision: task.revision };
        attempt.status = 'committed';
      }).catch(() => {}).finally(() => {
        if (attempt.status === 'pending') attempt.status = 'invalidated';
        if (item.controller === controller) item.controller = undefined;
      });
      inFlight.add(promise); promise.finally(() => {
        inFlight.delete(promise);
        if (data.disposed && item.controller === undefined && work.get(child) === item) work.delete(child);
      });
    }
  }
  return Object.freeze({
    observe,
    message(child, generateMessage) {
      const data = state.childState.get(child);
      if (!active || !data || !alive(data.lead, child) || typeof generateMessage !== 'function') throw new Error('invalid synthetic message work');
      const item = supersede(child, 'message'), revision = item.revision;
      item.messageCut = state.leadState.get(data.lead).high;
      item.kind = 'message';
      const controller = new AbortController(); item.controller = controller;
      const authorizationEpoch = state.authorizationEpoch();
      const promise = Promise.resolve().then(async () => {
        if (!alive(data.lead, child) || controller.signal.aborted || item.revision !== revision ||
            !state.authorized() || state.authorizationEpoch() !== authorizationEpoch || data.title?.kind === 'user') return;
        const title = await generateMessage(Object.freeze({ signal: controller.signal }));
        if (!alive(data.lead, child) || controller.signal.aborted || item.revision !== revision ||
            !state.authorized() || state.authorizationEpoch() !== authorizationEpoch || data.title?.kind === 'user' || !nonempty(title)) return;
        data.title = { kind: 'message', title: title.trim() };
      }).catch(() => {}).finally(() => { if (item.controller === controller) item.controller = undefined; });
      inFlight.add(promise); promise.finally(() => {
        inFlight.delete(promise);
        if (data.disposed && item.controller === undefined && work.get(child) === item) work.delete(child);
      });
    },
    rename(child, title) {
      const data = state.childState.get(child);
      if (!active || !data || state.children.get(data.id) !== child || !nonempty(title)) throw new Error('invalid synthetic rename');
      supersede(child, 'rename'); data.title = { kind: 'user', title: title.trim() };
    },
    invalidate(child) {
      const data = state.childState.get(child);
      if (!data) return;
      if (!active || state.children.get(data.id) !== child) {
        // Disposed synthetic children still need cooperative in-flight cancellation.
        if (data.disposed && work.has(child)) { supersede(child, 'invalidate'); work.delete(child); }
        return;
      }
      const item = supersede(child, 'invalidate');
      const parent = state.leadState.get(data.lead);
      if (parent && state.leads.get(parent.id) === data.lead) item.invalidationCut = parent.high;
      else item.blockedLead = data.lead; // No trustworthy cut: fail closed for this exact lead lifecycle.
    },
    async idle() { while (inFlight.size) await Promise.allSettled([...inFlight]); },
    dispose() {
      if (closePromise !== undefined) return closePromise;
      active = false;
      for (const child of work.keys()) supersede(child, 'dispose');
      closePromise = (async () => {
        while (inFlight.size) await Promise.allSettled([...inFlight]);
        work.clear();
        if (state.owner === owner) state.owner = undefined;
      })();
      return closePromise;
    },
  });
}

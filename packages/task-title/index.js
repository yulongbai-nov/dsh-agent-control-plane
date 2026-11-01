export const name = 'task-title';
export const inject = ['sessionTitle', 'sessions'];

function latestTask(lead, ownerId) {
  const tasks = new Map();
  for (const event of lead.snapshotEvents()) {
    if (event.type !== 'team/task' || event.data?.teamId !== lead.id) continue;
    const task = event.data.task;
    if (event.data.version !== 2 || !task || typeof task.id !== 'string' || !task.id ||
        !Number.isSafeInteger(task.revision) || task.revision < 1 ||
        typeof task.subject !== 'string' || !['pending', 'in_progress', 'completed', 'deleted'].includes(task.status) ||
        (task.ownerId !== undefined && (typeof task.ownerId !== 'string' || !task.ownerId))) {
      throw new Error('invalid team task event');
    }
    const previous = tasks.get(task.id);
    if (task.revision !== (previous?.task.revision ?? 0) + 1) throw new Error('invalid team task revision');
    const startsWork = task.status === 'in_progress' &&
      (previous?.task.status !== 'in_progress' || previous.task.ownerId !== task.ownerId);
    const entersCompletion = task.status === 'completed' && previous?.task.status !== 'completed';
    tasks.set(task.id, {
      task,
      startedSeq: startsWork ? event.seq : previous?.startedSeq,
      completedSeq: entersCompletion ? event.seq : previous?.completedSeq,
    });
  }
  const owned = [...tasks.values()].filter(({ task }) => task.ownerId === ownerId && task.subject.trim());
  const active = owned.filter(({ task }) => task.status === 'in_progress').sort((a, b) => b.startedSeq - a.startedSeq);
  const completed = owned.filter(({ task, completedSeq }) => task.status === 'completed' && completedSeq !== undefined)
    .sort((a, b) => b.completedSeq - a.completedSeq);
  return active[0]?.task.subject.trim() ?? completed[0]?.task.subject.trim();
}

export function createProvider(sessions) {
  return {
    id: name,
    automatic: 'all-prompts',
    async generate(request) {
      request.signal.throwIfAborted();
      if (request.currentTitle?.source.kind === 'user') throw new Error('pinned user title');
      const last = request.messages.at(-1);
      if (!last) throw new Error('a human message is required');
      const parentId = request.session.header.parentSession;
      const lead = parentId === undefined ? undefined : sessions.get(parentId);
      const title = lead === undefined ? undefined : latestTask(lead, request.session.id);
      request.signal.throwIfAborted();
      if (!title) throw new Error('no eligible task');
      return { title, messageSeqs: [last.seq] };
    },
  };
}

export function apply(ctx) {
  return ctx.sessionTitle.register(createProvider(ctx.sessions));
}

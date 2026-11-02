/** Synthetic only. Context must be issued by the real Gateway in production;
 * this function cannot authenticate an in-process Context or fixture source. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

type SyntheticHandle = { read: (offset:number, length:number) => Promise<{events:readonly unknown[]}>, close: () => Promise<void> }
type SyntheticSource = {open: (id:SessionId, access:'read') => Promise<SyntheticHandle>}

export async function readSyntheticSessionCount(ctx:Context, source:SyntheticSource, id:SessionId):Promise<number> {
  const inv = ctx.invocation
  // Do not use principalOf here: it deliberately conflates owner with local.
  if (inv === undefined || inv.peer === undefined || inv.peer.principal === undefined || inv.signal.aborted || inv.peer.signal.aborted || inv.request.namespace !== 'session' || inv.request.method !== 'projections') throw Error('DENIED')
  const allowed = () => !inv.signal.aborted && !inv.peer.signal.aborted && ctx.remoteAccess.allows({kind:'session',id})
  if (!allowed()) throw Error('DENIED')
  const handle = await source.open(id,'read')
  try {
    if (!allowed()) throw Error('DENIED')
    // A bounded sample only; never infer total or durable source identity.
    const result = await handle.read(0,100)
    if (!allowed()) throw Error('DENIED')
    return result.events.length
  } finally { await handle.close() }
}

/** Synthetic format experiment only; not registered with the production catalog. */
import { defineSessionFormatMigration, SessionFormatError } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SessionFormatEvent, SessionFormatHeader, SessionFormatMigrationContext } from '@deepseek-ai/dsh-session-format'

function assertV5Fixture(header: SessionFormatHeader): void {
  if (header.version !== 5) throw new SessionFormatError('fixture header must be v5')
  assertReleasedV4Header({...header,version:4})
}
/** Header-only synthetic envelope; no claim of a complete V5 physical codec. */
export function decodeV5FixtureHeader(value:unknown):SessionFormatHeader {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SessionFormatError('invalid fixture header')
  const header = structuredClone(value) as SessionFormatHeader
  assertV5Fixture(header)
  return header
}
export const fixtureV4ToV5 = defineSessionFormatMigration({
  name:'@synthetic/v4-to-v5',fromVersion:4,toVersion:5,
  migrateHeader(header) { assertReleasedV4Header(header);return {...header,version:5} },
  validateTargetHeader:assertV5Fixture,
  createStage(input) {
    if (input.sourceInheritedEventCount === undefined || !Number.isSafeInteger(input.sourceInheritedEventCount) || input.sourceInheritedEventCount < 0) throw new SessionFormatError('unknown inherited cut')
    const cut=input.sourceInheritedEventCount
    let next=0
    return {
      headerInheritedEventCount:cut,
      transformEvent(event:SessionFormatEvent,context:SessionFormatMigrationContext) {
        if (event.seq!==next++) throw new SessionFormatError('noncontiguous fixture sequence')
        context.emitEvent(structuredClone(event))
      },
      transformRun() { throw new SessionFormatError('compact runs unsupported by fixture') },
      finish() {if (cut>next) throw new SessionFormatError('cut beyond fixture events');return cut},
    }
  },
})

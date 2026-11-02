/** Experimental read-only V5 physical codec using unchanged V4 event vocabulary.
 * Not registered with the product, no task-title writer or production migration. */
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalog, defineSessionFormatMigration, SessionFormatError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatCodec, SessionFormatCurrentEncoder, SessionFormatEvent, SessionFormatEventRun, SessionFormatHeader, SessionFormatMigrationContext } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, releasedV4SessionFormatCodec, restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { sessionFormatCatalogOptions } from '../packages/session/session-format-catalog/src/generated.ts'
import { validateInstalledCurrentSessionArtifact } from '../packages/session/session-format-catalog/src/current.ts'

const toV4=(header:SessionFormatHeader):SessionFormatHeader=>({...header,version:4})
function v5header(value:unknown):SessionFormatHeader {
 if (typeof value!=='object'||value===null||Array.isArray(value)||(value as {version?:unknown}).version!==5) throw new SessionFormatError('expected v5 header')
 const decoded=releasedV4SessionFormatCodec.decodeHeader({...value,version:4});return {...decoded,version:5}
}
export const v5ReadOnlyCodec:SessionFormatCodec & SessionFormatCurrentEncoder={
 version:5, decodeHeader:v5header,
 createDecoder(value,recovery){
  const header=v5header(value)
  // This experiment refuses recoverable-tail mode; no partial source repair.
  if (recovery!=='strict') throw new SessionFormatError('strict recovery required')
  const dec=releasedV4SessionFormatCodec.createDecoder({...value as object,version:4},recovery)
  return {...dec,header}
 },
 encodeHeader(){throw new SessionFormatError('direct fixture writing disabled')},
 encodeEvent(){throw new SessionFormatError('direct fixture writing disabled')},
}
const edge=defineSessionFormatMigration({
 name:'@synthetic/strict-v4-to-v5',fromVersion:4,toVersion:5,
 migrateHeader(h){assertReleasedV4Header(h);if(h.isSeeded) throw new SessionFormatError('seeded migration unsupported');return {...h,version:5}},
 validateTargetHeader(h){if(h.version!==5) throw new SessionFormatError('expected v5');assertReleasedV4Header(toV4(h));if(h.isSeeded) throw new SessionFormatError('seeded migration unsupported')},
 createStage(input){
  if(input.sourceHeader.isSeeded || (input.sourceInheritedEventCount!==undefined && input.sourceInheritedEventCount!==0)) throw new SessionFormatError('unsafe inherited cut')
  let next=0
  const emit=(event:SessionFormatEvent,context:SessionFormatMigrationContext)=>{if(event.seq!==next++) throw new SessionFormatError('sequence gap');context.emitEvent(event)}
  return {headerInheritedEventCount:0,transformEvent:emit,transformRun(run:SessionFormatEventRun,context:SessionFormatMigrationContext){for(const event of run.expand()) emit(event,context)},finish(){return 0}}
 },
})
function validateV5(a:SessionFormatArtifact):SessionFormatArtifact {
 if(a.header.version!==5) throw new SessionFormatError('expected v5 artifact')
 const legacy={...a,header:toV4(a.header)}
 restoreReleasedV4Artifact(legacy,KNOWN_SESSION_EVENT_TYPES)
 validateInstalledCurrentSessionArtifact(legacy)
 return a
}
/** Fixture encoder validates the whole legacy-compatible artifact before producing rows;
 * returning rows does not perform disk writes or establish transactional publication. */
export function encodeValidatedFixture(a:SessionFormatArtifact):readonly unknown[] {
 validateV5(a)
 const physicalHeader=releasedV4SessionFormatCodec.encodeHeader(toV4(a.header),a.inheritedEventCount)
 return [{...physicalHeader,version:5},...a.events.map(e=>releasedV4SessionFormatCodec.encodeEvent(e))]
}
export const experimentalV5Catalog=createSessionFormatCatalog({
 ...sessionFormatCatalogOptions,currentVersion:5,
 codecs:[...sessionFormatCatalogOptions.codecs,v5ReadOnlyCodec],currentEncoder:v5ReadOnlyCodec,
 migrations:[...sessionFormatCatalogOptions.migrations,edge],
 restoreCurrent:validateV5,restoreTransformedCurrent:validateV5,
 restoreCurrentHeader(h){if(h.version!==5)throw new SessionFormatError('expected v5');assertReleasedV4Header(toV4(h));return h},
})

/** Test-only migration shape; neither writes nor changes the installed catalog. */
import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '../src/index.ts'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { decodeV5FixtureHeader, fixtureV4ToV5 } from '../../../../synthetic-title-migration-wip/edge.ts'
const h={version:4,id:'synthetic',createdAt:1,isSeeded:false,delegationDepth:0}
const events=[{type:'session/title',seq:0,time:2,data:{title:'Synthetic',source:{kind:'user'}}},{type:'session/title',seq:1,time:3,data:{title:'Future',source:{kind:'unknown-future',extra:'synthetic'}}},{type:'plugin/opaque',seq:2,time:4,data:{source:{kind:'unknown-future',extra:'synthetic'}},ignorable:true}]
describe('synthetic V4 to V5 edge shape',()=>{
 it('preserves decoded rows, opaque future source and ordering without inventing provenance',()=>{
  const target=fixtureV4ToV5.migrateHeader(h), output=new SessionFormatEventCollector()
  const stage=fixtureV4ToV5.createStage({sourceHeader:h,targetHeader:target,sourceInheritedEventCount:0,sourceKind:'decoded'})
  for(const row of events) stage.transformEvent(row,output)
  expect(stage.finish(output)).toBe(0);expect(output.values).toEqual(events);expect(decodeV5FixtureHeader(target)).toEqual({...h,version:5})
 })
 it('rejects unknown cuts, gaps and out-of-bounds cuts rather than guessing',()=>{
  const target=fixtureV4ToV5.migrateHeader(h)
  expect(()=>fixtureV4ToV5.createStage({sourceHeader:h,targetHeader:target,sourceInheritedEventCount:undefined,sourceKind:'decoded'})).toThrow(/cut/)
  const stage=fixtureV4ToV5.createStage({sourceHeader:h,targetHeader:target,sourceInheritedEventCount:3,sourceKind:'decoded'});const output=new SessionFormatEventCollector()
  stage.transformEvent(events[0],output);expect(()=>stage.finish(output)).toThrow(/cut/)
  const other=fixtureV4ToV5.createStage({sourceHeader:h,targetHeader:target,sourceInheritedEventCount:0,sourceKind:'decoded'});expect(()=>other.transformEvent(events[1],output)).toThrow(/sequence/)
 })
 it('pinned V4 catalog rejects V5 before any writing',()=>{
  expect(sessionFormatCatalog.readHeader({...h,version:5})).toMatchObject({status:'unsupported',storedVersion:5,targetVersion:4})
  expect(()=>sessionFormatCatalog.createRestore({...h,version:5},{recovery:'strict',validation:'current'})).toThrow(/newer format/)
 })
})

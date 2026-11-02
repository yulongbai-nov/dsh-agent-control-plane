/** Fixture-only codec and migration; never touches installed session format or data. */
import { describe,expect,it } from 'vitest'
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { experimentalV5Catalog,encodeValidatedFixture } from '../../../../synthetic-title-migration-wip/v5-codec.ts'
const header={version:4,id:'synthetic',createdAt:1,isSeeded:false,delegationDepth:0}
const title={type:'session/title',seq:0,time:2,data:{title:'Synthetic title',messageSeqs:[],source:{kind:'user'}}}
const opaque={type:'plugin:synthetic',seq:1,time:3,data:{value:'opaque'},ignorable:true}
const physical=()=>[releasedV4SessionFormatCodec.encodeHeader(header,0),releasedV4SessionFormatCodec.encodeEvent(title),releasedV4SessionFormatCodec.encodeEvent(opaque)]
const load=(catalog:typeof experimentalV5Catalog, rows:readonly unknown[])=>{const r=catalog.createRestore(rows[0],{recovery:'strict',validation:'current'});for(const row of rows.slice(1)) r.decodeRow(row);return r.finish()}
describe('experimental V5 physical compatibility',()=>{
 it('reads V4 and V5 physical rows preserving title and opaque records; V4 rejects V5',()=>{
  const migrated=load(experimentalV5Catalog,physical());expect(migrated.header.version).toBe(5);expect(migrated.events).toEqual([title,opaque])
  const rows=encodeValidatedFixture(migrated);expect(load(experimentalV5Catalog,rows)).toEqual(migrated)
  expect(sessionFormatCatalog.readHeader(rows[0])).toMatchObject({status:'unsupported',storedVersion:5,targetVersion:4})
  expect(()=>sessionFormatCatalog.createRestore(rows[0],{recovery:'strict',validation:'current'})).toThrow(/newer format/)
  expect(()=>experimentalV5Catalog.encodeCurrentEvent(title)).toThrow(/writing disabled/)
 })
 it('fails closed for unknown title source, malformed sequence and seeded headers',()=>{
  const rows=physical();rows[1]={...title,data:{...title.data,source:{kind:'unknown-future'}}}
  expect(()=>load(experimentalV5Catalog,rows)).toThrow()
  expect(()=>load(experimentalV5Catalog,[physical()[0],{...title,seq:1}])).toThrow()
  expect(()=>experimentalV5Catalog.createRestore({...physical()[0],isSeeded:true},{recovery:'strict',validation:'current'})).toThrow()
 })
 it('an interrupted isolated staging write leaves the original V4 bytes unchanged',async()=>{
  const root=await mkdtemp(join(tmpdir(),'title-v5-fixture-'));const source=join(root,'source-v4.jsonl'),stage=join(root,'candidate-v5.stage')
  try {
   const bytes=physical().map(x=>JSON.stringify(x)).join('\n')+'\n';await writeFile(source,bytes,{flag:'wx'})
   const migrated=load(experimentalV5Catalog,(await readFile(source,'utf8')).trimEnd().split('\n').map(x=>JSON.parse(x)))
   const candidate=encodeValidatedFixture(migrated).map(x=>JSON.stringify(x)).join('\n')+'\n'
   await writeFile(stage,candidate.slice(0,Math.floor(candidate.length/2)),{flag:'wx'})
   expect(await readFile(source,'utf8')).toBe(bytes)
   expect(()=>sessionFormatCatalog.createRestore(JSON.parse(candidate.split('\n')[0]),{recovery:'strict',validation:'current'})).toThrow(/newer format/)
  } finally {await rm(root,{recursive:true,force:true})}
 })
})

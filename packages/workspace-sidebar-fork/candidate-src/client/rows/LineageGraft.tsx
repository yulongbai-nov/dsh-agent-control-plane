/** Experimental source candidate; not an authorization boundary or installed plugin. */
import { Fragment, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { SessionNode, SessionRowState } from '../tree.ts'
import { planLineage, type LineageRow } from './lineage-plan.mjs'

type Target = { parentSessionId:SessionId, childSessionId:SessionId, mode:'one-shot'|'continuable' }
type Props = {
  root:SessionNode; scopeRootIds:readonly SessionId[]; list:SessionListState; statuses:unknown;
  rowState:SessionRowState; t:WorkspaceBrowserProps['t'];
  refreshLineage:(id:SessionId)=>Promise<unknown>|void; openLineage:(target:Target)=>void;
  renderNative:(toggle:ReactNode)=>ReactNode;
}

export function LineageGraft({ root, scopeRootIds, list, statuses, rowState, t, refreshLineage, openLineage, renderNative }:Props) {
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set())
  const [failure,setFailure]=useState(false)
  const generation=useRef(0)
  useEffect(()=>()=>{generation.current++},[])
  const rootOpen=expanded.has(root.id)
  const rows=rootOpen ? planLineage({rootId:root.id,scopeRootIds,list,expanded,archived:new Set(rowState.archivedSessionIds),statuses,archivedFilter:rowState.archivedFilter}) : []
  const toggle=(id:string, open:boolean):void=>{
    const next=new Set(expanded)
    if(open)next.add(id)
    else if(id===root.id)next.clear()
    else {
      next.delete(id)
      const start=rows.findIndex(row=>row.id===id&&!row.ambiguous)
      const parentLevel=rows[start]?.level
      if(parentLevel!==undefined)for(let i=start+1;i<rows.length;i++){
        const descendant=rows[i]
        if(!descendant||descendant.level<=parentLevel)break
        next.delete(descendant.id)
      }
    }
    setExpanded(next)
    const current=++generation.current;setFailure(false)
    if(open)Promise.resolve().then(()=>{if(generation.current===current)return refreshLineage(id as SessionId)}).catch(()=>{if(generation.current===current)setFailure(true)})
  }
  const toggleRoot=root.blank ? null : <button type="button" aria-expanded={rootOpen} aria-label={t(rootOpen?'lineage.collapse':'lineage.expand',{ title:root.title })} onClick={(event:MouseEvent<HTMLButtonElement>)=>{event.stopPropagation();toggle(root.id,!rootOpen)}}>{rootOpen?'▾':'▸'}</button>
  const renderChild=(row:LineageRow):ReactNode=>{
    const target=row.target
    return <div role="treeitem" aria-level={row.level+1} aria-expanded={row.expandable?row.expanded:undefined} aria-disabled={target===null||undefined} key={row.rowKey} data-lineage-key={row.rowKey} style={{paddingInlineStart:`${row.level*16}px`}}>
      {row.expandable&&<button type="button" aria-label={t(row.expanded?'lineage.collapse':'lineage.expand',{title:row.title})} onClick={()=>toggle(row.id,!row.expanded)}>{row.expanded?'▾':'▸'}</button>}
      <button type="button" disabled={target===null} onClick={()=>{if(target)openLineage({parentSessionId:target.parentSessionId as SessionId,childSessionId:target.childSessionId as SessionId,mode:target.mode})}}>{row.title}</button>
    </div>
  }
  return <Fragment>{renderNative(toggleRoot)}{rootOpen&&<div role="group">{failure&&<div role="alert">{t('lineage.error')}</div>}{rows.map(renderChild)}</div>}</Fragment>
}

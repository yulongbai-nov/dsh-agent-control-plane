/** Experimental source candidate; not an authorization boundary or installed plugin. */
import { Fragment, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
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
  renderNative:(toggle:ReactNode, expanded:boolean|undefined, groupId:string|undefined)=>ReactNode;
}

export function LineageGraft({ root, scopeRootIds, list, statuses, rowState, t, refreshLineage, openLineage, renderNative }:Props) {
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set())
  const [failure,setFailure]=useState(false)
  const generation=useRef(0)
  const groupId=`dsh-lineage-${useId()}`
  const rootToggle=useRef<HTMLButtonElement|null>(null)
  const removedFocus=useRef<{ node:HTMLElement, id:string, unambiguous:boolean, ancestors:string[] }|null>(null)
  const groupRef=useRef<HTMLDivElement|null>(null)
  useEffect(()=>()=>{generation.current++},[])
  const rootOpen=expanded.has(root.id)
  const rows=rootOpen ? planLineage({rootId:root.id,scopeRootIds,list,expanded,archived:new Set(rowState.archivedSessionIds),statuses,archivedFilter:rowState.archivedFilter}) : []
  useLayoutEffect(()=>{
    const snapshot=removedFocus.current;removedFocus.current=null
    if(!snapshot||snapshot.node.isConnected||document.activeElement!==document.body)return
    const matches=snapshot.unambiguous?rows.filter(row=>row.id===snapshot.id&&!row.ambiguous&&row.target!==null):[]
    const target=matches.length===1?matches[0]:snapshot.ancestors.map(key=>rows.find(row=>row.rowKey===key&&!row.ambiguous&&row.target!==null)).find(Boolean)
    const nodes=groupRef.current?.querySelectorAll<HTMLElement>('[data-lineage-key]')??[]
    const rowNode=target?[...nodes].find(node=>node.dataset.lineageKey===target.rowKey):undefined
    const openButton=rowNode?.querySelector<HTMLButtonElement>('[data-lineage-open]')
    if(openButton&&!openButton.disabled)openButton.focus()
    else if(rootToggle.current?.isConnected)rootToggle.current.focus()
  })
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
  const childRows=new Map<string,LineageRow[]>()
  for(const row of rows){if(row.parentKey!==null){const siblings=childRows.get(row.parentKey)??[];siblings.push(row);childRows.set(row.parentKey,siblings)}}
  const elementFor=(key:string):HTMLElement|undefined=>[...(groupRef.current?.querySelectorAll<HTMLElement>('[data-lineage-key]')??[])].find(node=>node.dataset.lineageKey===key)
  const controlFor=(node:HTMLElement|undefined):HTMLButtonElement|null=>{
    const controls=node?.querySelector<HTMLElement>(':scope > [data-lineage-controls]')
    return controls?.querySelector<HTMLButtonElement>('[data-lineage-open]:not(:disabled)')??controls?.querySelector<HTMLButtonElement>('[data-lineage-toggle]:not(:disabled)')??null
  }
  const focusRow=(row:LineageRow|undefined):boolean=>{const control=row?controlFor(elementFor(row.rowKey)):null;if(!control)return false;control.focus();return true}
  const focusRoot=():boolean=>{if(!rootToggle.current?.isConnected)return false;rootToggle.current.focus();return true}
  const focusAdjacent=(index:number,step:1|-1):boolean=>{for(let i=index;i>=0&&i<rows.length;i+=step)if(focusRow(rows[i]))return true;return false}
  const handleRowKey=(event:KeyboardEvent<HTMLDivElement>,row:LineageRow):void=>{
    if(!(event.target instanceof HTMLElement)||event.target.closest('[data-lineage-key]')!==event.currentTarget)return
    const index=rows.findIndex(item=>item.rowKey===row.rowKey)
    if(index<0||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
    let handled=false
    if(event.key==='ArrowLeft'){
      if(row.expanded){toggle(row.id,false);handled=true}
      else {const parent=rows.find(item=>item.rowKey===row.parentKey);handled=parent?focusRow(parent):focusRoot()}
    }
    else if(event.key==='ArrowRight'){
      if(row.expandable&&!row.expanded){toggle(row.id,true);handled=true}
      else {const child=rows[index+1];if(child?.parentKey===row.rowKey)handled=focusRow(child)}
    }
    else if(event.key==='Home')handled=focusRoot()
    else if(event.key==='End')handled=focusAdjacent(rows.length-1,-1)
    else if(event.key==='ArrowUp')handled=focusAdjacent(index-1,-1)||focusRoot()
    else handled=focusAdjacent(index+1,1)
    if(handled){event.preventDefault();event.stopPropagation()}
  }
  const toggleRoot=root.blank ? null : <button ref={rootToggle} type="button" aria-expanded={rootOpen} aria-label={t(rootOpen?'lineage.collapse':'lineage.expand',{ title:root.title })} onKeyDown={(event:KeyboardEvent<HTMLButtonElement>)=>{let handled=false;if(event.key==='ArrowRight'&&!rootOpen){toggle(root.id,true);handled=true}else if(event.key==='ArrowLeft'&&rootOpen){toggle(root.id,false);handled=true}else if((event.key==='ArrowDown'||event.key==='ArrowRight')&&rootOpen)handled=focusAdjacent(0,1);if(handled){event.preventDefault();event.stopPropagation()}}} onClick={(event:MouseEvent<HTMLButtonElement>)=>{event.stopPropagation();toggle(root.id,!rootOpen)}}>{rootOpen?'▾':'▸'}</button>
  const renderChild=(row:LineageRow):ReactNode=>{
    const target=row.target
    let focusNode:HTMLDivElement|null=null
    return <div ref={(node:HTMLDivElement|null)=>{
      if(node){focusNode=node;return}
      if(!focusNode||!(document.activeElement instanceof HTMLElement)||document.activeElement.closest('[data-lineage-key]')!==focusNode)return
      const ancestors:string[]=[];let key=row.parentKey
      while(key!==null){ancestors.push(key);const parent=rows.find(item=>item.rowKey===key);if(!parent)break;key=parent.parentKey}
      removedFocus.current={node:focusNode,id:row.id,unambiguous:!row.ambiguous,ancestors}
    }} role="treeitem" aria-expanded={row.expandable?row.expanded:undefined} aria-disabled={target===null&&!row.expandable||undefined} key={row.rowKey} data-lineage-key={row.rowKey} onKeyDown={(event:KeyboardEvent<HTMLDivElement>)=>handleRowKey(event,row)}>
      <div data-lineage-controls style={{paddingInlineStart:`${row.level*16}px`}}>
        {row.expandable&&<button data-lineage-toggle type="button" aria-label={t(row.expanded?'lineage.collapse':'lineage.expand',{title:row.title})} onClick={()=>toggle(row.id,!row.expanded)}>{row.expanded?'▾':'▸'}</button>}
        <button data-lineage-open type="button" disabled={target===null} onClick={()=>{if(target)openLineage({parentSessionId:target.parentSessionId as SessionId,childSessionId:target.childSessionId as SessionId,mode:target.mode})}}>{row.title}</button>
      </div>
      {(childRows.get(row.rowKey)?.length??0)>0&&<div role="group">{childRows.get(row.rowKey)?.map(renderChild)}</div>}
    </div>
  }
  return <Fragment>{renderNative(toggleRoot,root.blank?undefined:rootOpen,rootOpen?groupId:undefined)}{rootOpen&&<div id={groupId} ref={groupRef} role="group">{failure&&<div role="alert">{t('lineage.error')}</div>}{rows.filter(row=>row.level===2).map(renderChild)}</div>}</Fragment>
}

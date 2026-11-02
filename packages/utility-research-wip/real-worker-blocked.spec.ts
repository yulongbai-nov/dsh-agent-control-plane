/** Synthetic only: real Workflow Host and ToolRuntime, real PTC worker and synthetic confirmation. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import PtcWorkflowEngine from '../src/index.ts'
import { externalTestParent } from '../../../subagent/subagent/tests/external-activation-helpers.ts'
import { mountSyntheticUtility } from '../../../../synthetic-utility-wip/host-tool.ts'

describe('synthetic utility through real PTC worker', () => {
  it('deduplicates concurrent dispatch and handles promotion, rollback, disable, and run cleanup', async () => {
    const ctx = new Context()
    const root = await mkdtemp(join(tmpdir(),'synthetic-utility-worker-'))
    try {
      await ctx.plugin(SessionStore); await ctx.plugin(AgentRegistry); await ctx.plugin(SessionProjections)
      await ctx.plugin(FileSystem); await ctx.plugin(Subprocess); await ctx.plugin(Sandbox)
      await ctx.plugin(SandboxPolicy,{mode:'read-only',workspaceRoot:root}); provideWorkingDirectoryFixture(ctx, root); await ctx.plugin(SubagentRuntime)
      let childStarts = 0
      ctx.subagents.registerProvider({name:'stub',capabilities:{agentOptions:true,agentPreset:false,outputSchema:true,depthLimit:false},inheritsParentContext:false,start:async()=>{ childStarts++; throw Error('unexpected child') }})
      await ctx.plugin(NodePtcRuntime,{executionMode:'per-call',graceMs:50}); const spawn = vi.spyOn(ctx.subprocess,'spawn'); await ctx.plugin(PtcWorkflowEngine,{provider:'stub'})
      await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
      const parent = await externalTestParent(ctx, root)
      let confirmed = false, starts = 0, disposals = 0
      const fixture = async (_input:string) => {
        const run = ctx.workflowEngine.start({script:'return null',meta:{name:'synthetic-utility',description:'inert test'},parent})
        starts++
        try { const result = await run.result; if (result.stopReason !== 'completed') throw Error(`synthetic run failed: ${result.stopReason} ${result.error ?? ''}`); return 'ok' }
        finally { await run.dispose(); disposals++ }
      }
      const {registry} = mountSyntheticUtility(ctx, new Map([['demo@1',fixture],['demo@2',fixture]]) as never, () => confirmed)
      const invoke = (version:number,requestId:string) => ctx.tools.execute({name:'run_utility',callId:ToolCallId(`test-${requestId}`),arguments:{id:'demo',version,input:'fixture',requestId},signal:new AbortController().signal})
      await expect(registry.promote('demo',1)).rejects.toThrow('NOT_CONFIRMED')
      expect((await invoke(1,'denied')).isError).toBe(true); expect(starts).toBe(0)
      confirmed = true; await registry.promote('demo',1)
      const results = await Promise.all([invoke(1,'same'),invoke(1,'same')]); expect(results, JSON.stringify(results)).toSatisfy(rs=>rs.every((r:{isError:boolean})=>!r.isError))
      expect(starts).toBe(1); expect(disposals).toBe(1); expect(spawn).toHaveBeenCalledTimes(1); expect(childStarts).toBe(0)
      await registry.promote('demo',2); expect((await invoke(1,'old')).isError).toBe(true)
      expect((await invoke(2,'new')).isError).toBe(false)
      await registry.promote('demo',1); expect((await invoke(1,'rollback')).isError).toBe(false)
      registry.disable('demo'); expect((await invoke(1,'disabled')).isError).toBe(true)
      expect(starts).toBe(3); expect(disposals).toBe(3); expect(spawn).toHaveBeenCalledTimes(3); expect(childStarts).toBe(0)
      for (const result of spawn.mock.results) expect(await result.value.waitForExit()).toBe(true)
    } finally { await ctx.fiber.dispose(); await rm(root,{recursive:true,force:true}) }
  })
})

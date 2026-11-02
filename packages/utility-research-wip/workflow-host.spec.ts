/** Synthetic only: real Workflow Host and ToolRuntime, fake PTC executor and confirmation. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
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

class InertRuntime extends PtcRuntime {
  language = 'typescript'; readonly isolation = 'process'; override get sandboxMode() { return 'read-only' as const }
  calls = 0
  resolve(request:PtcRunRequest):PtcRunSpec { return {...request,cwd:request.cwd ?? process.cwd(),timeoutMs:request.timeoutMs ?? 120000} }
  async run(_spec:PtcRunSpec):Promise<PtcRunResult> { this.calls++; return {logs:[], value:{value:null,stopReason:'completed',agentsStarted:0}} }
}

describe('synthetic utility through pinned PTC Workflow Host', () => {
  it('deduplicates concurrent dispatch and handles promotion, rollback, disable, and run cleanup', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore); await ctx.plugin(AgentRegistry); await ctx.plugin(SessionProjections)
      await ctx.plugin(SandboxPolicy,{mode:'read-only'}); provideWorkingDirectoryFixture(ctx); await ctx.plugin(SubagentRuntime)
      let childStarts = 0
      ctx.subagents.registerProvider({name:'stub',capabilities:{agentOptions:true,agentPreset:false,outputSchema:true,depthLimit:false},inheritsParentContext:false,start:async()=>{ childStarts++; throw Error('unexpected child') }})
      await ctx.plugin(InertRuntime); await ctx.plugin(PtcWorkflowEngine,{provider:'stub'})
      await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
      const parent = await externalTestParent(ctx, ctx.sandboxPolicy.workspaceRoot), runtime = ctx.ptcRuntime as InertRuntime
      let confirmed = false, starts = 0, disposals = 0
      const fixture = async (_input:string) => {
        const run = ctx.workflowEngine.start({script:'return null',meta:{name:'synthetic-utility',description:'inert test'},parent})
        starts++
        try { const result = await run.result; if (result.stopReason !== 'completed') throw Error('synthetic run failed'); return 'ok' }
        finally { await run.dispose(); disposals++ }
      }
      const {registry} = mountSyntheticUtility(ctx, new Map([['demo@1',fixture],['demo@2',fixture]]) as never, () => confirmed)
      const invoke = (version:number,requestId:string) => ctx.tools.execute({name:'run_utility',callId:ToolCallId(`test-${requestId}`),arguments:{id:'demo',version,input:'fixture',requestId},signal:new AbortController().signal})
      await expect(registry.promote('demo',1)).rejects.toThrow('NOT_CONFIRMED')
      expect((await invoke(1,'denied')).isError).toBe(true); expect(starts).toBe(0)
      confirmed = true; await registry.promote('demo',1)
      const results = await Promise.all([invoke(1,'same'),invoke(1,'same')]); expect(results.every(r=>!r.isError)).toBe(true)
      expect(starts).toBe(1); expect(disposals).toBe(1); expect(runtime.calls).toBe(1); expect(childStarts).toBe(0)
      await registry.promote('demo',2); expect((await invoke(1,'old')).isError).toBe(true)
      expect((await invoke(2,'new')).isError).toBe(false)
      await registry.promote('demo',1); expect((await invoke(1,'rollback')).isError).toBe(false)
      registry.disable('demo'); expect((await invoke(1,'disabled')).isError).toBe(true)
      expect(starts).toBe(3); expect(disposals).toBe(3); expect(runtime.calls).toBe(3); expect(childStarts).toBe(0)
    } finally { await ctx.fiber.dispose() }
  })
})

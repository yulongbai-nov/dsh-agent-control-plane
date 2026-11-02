import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mountSyntheticUtility } from '../../../../synthetic-utility-wip/host-tool.ts'

describe('synthetic run_utility in real ToolRuntime', () => {
  it('requires confirmation, rejects disabled versions, supports rollback and deduplicates', async () => {
    const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    let allowed = false, count = 0
    const {registry} = mountSyntheticUtility(ctx, new Map([['sample@1', (s:string) => {count++; return `v1:${s}`}], ['sample@2', (s:string) => `v2:${s}`]]), () => allowed)
    const call = (version:number, requestId:string) => ctx.tools.execute({callId:ToolCallId(`call-${requestId}`), name:'run_utility', arguments:{id:'sample',version,input:'synthetic',requestId},signal:new AbortController().signal})
    try {
      await expect(registry.promote('sample',1)).rejects.toThrow('NOT_CONFIRMED')
      expect((await call(1,'a')).isError).toBe(true)
      allowed = true; await registry.promote('sample',1)
      expect((await call(1,'a')).isError).toBe(false)
      expect((await call(1,'a')).isError).toBe(false); expect(count).toBe(1)
      await registry.promote('sample',2); expect((await call(1,'b')).isError).toBe(true)
      expect((await call(2,'c')).isError).toBe(false)
      await registry.promote('sample',1); expect((await call(1,'d')).isError).toBe(false)
      registry.disable('sample'); expect((await call(1,'e')).isError).toBe(true)
    } finally { await ctx.fiber.dispose() }
  })
})

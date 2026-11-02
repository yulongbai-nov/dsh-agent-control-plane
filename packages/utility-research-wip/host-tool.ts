// Synthetic-only adapter: no production Host registration or workflow engine.
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createSyntheticUtilityRegistry } from './registry.mjs'

export function mountSyntheticUtility(ctx: Context, fixtures: Map<string, (input: string) => string>, confirm: (value: {id:string, version:number}) => boolean | Promise<boolean>) {
  const registry = createSyntheticUtilityRegistry(fixtures, confirm)
  const dispose = ctx.tools.register(defineTool({
    name: 'run_utility', description: 'Run a manually approved synthetic fixture utility.',
    parameters: {
      id: {type:'string', required:true, description:'Fixture id'},
      version: {type:'integer', required:true, description:'Approved version'},
      input: {type:'string', required:true, description:'Synthetic input'},
      requestId: {type:'string', required:true, description:'Synthetic idempotency key'},
    },
    output: {schema:{type:'string'}, render:(_args, value) => [{type:'text',text:value}]},
    execute: async args => registry.run_utility(args),
  }))
  return {registry, dispose}
}

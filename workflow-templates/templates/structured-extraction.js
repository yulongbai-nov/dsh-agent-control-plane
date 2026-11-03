// 结构化抽取：多个来源并行抽成同一 schema，再合并去重。
// args: { sources: string[], fields: string[] }
const sources = Array.isArray(args?.sources) ? args.sources : []
const fields = Array.isArray(args?.fields) && args.fields.length ? args.fields : ['name', 'value', 'evidence']
if (sources.length === 0) throw new Error('args.sources must be a non-empty array')

const itemSchema = {
  type: 'object',
  properties: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])),
  required: fields,
  additionalProperties: false,
}

phase('Extract')
const extracted = await parallel(
  sources.map((source) => () =>
    agent(`Extract every record from ${source} matching this field set: ${fields.join(', ')}. Return JSON array, no prose.`, {
      label: `extract ${source}`,
      phase: 'Extract',
      schema: { type: 'array', items: itemSchema },
    }),
  ),
)

phase('Merge')
const merged = await agent(
  `Merge these extracted arrays, dedupe by best available identity, and flag conflicting values with their sources.\n${JSON.stringify(extracted.filter(Boolean))}`,
  { label: 'merge', phase: 'Merge' },
)
return { sources: sources.length, extracted: extracted.filter(Boolean).length, merged }

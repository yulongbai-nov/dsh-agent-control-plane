// 文档同步：逐篇对照代码/README，列出需要更新的段落。
// args: { docs: string[], sourceOfTruth?: string }
const docs = Array.isArray(args?.docs) ? args.docs : []
if (docs.length === 0) throw new Error('args.docs must be a non-empty array of doc paths')

phase('Compare')
const diffs = await pipeline(
  docs,
  (doc) =>
    agent(
      `Compare ${doc} against ${args?.sourceOfTruth ?? 'the current code/README'}. List stale claims with the paragraph to rewrite. Return JSON [{section, stale, proposed}].`,
      { label: `compare ${doc}` },
    ),
  (comparison, doc) => agent(`Turn this comparison into a minimal patch plan for ${doc}. Do not rewrite the whole doc.\n${comparison}`, {
    label: `plan ${doc}`,
  }),
)

phase('Report')
const report = await agent(
  `Summarize which docs need updates and the smallest set of edits. ${docs.length} docs compared.\n${JSON.stringify(diffs.filter(Boolean))}`,
  { label: 'docs report', phase: 'Report' },
)
return { compared: docs.length, report }

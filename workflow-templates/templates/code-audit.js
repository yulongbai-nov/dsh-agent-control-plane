// 多文件代码审计：逐文件并行审查，再汇总风险。
// args: { files: string[], focus?: 'correctness'|'security'|'maintainability' }
const files = Array.isArray(args?.files) ? args.files : []
if (files.length === 0) throw new Error('args.files must be a non-empty array of paths')

phase('Audit')
const reviews = await parallel(
  files.map((file) => () =>
    agent(`Audit ${file} for correctness, security and maintainability. Return JSON with {file, severity, findings[], suggestions[]}.`, {
      label: `audit ${file}`,
      phase: 'Audit',
      schema: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          findings: { type: 'array', items: { type: 'string' } },
          suggestions: { type: 'array', items: { type: 'string' } },
        },
        required: ['file', 'severity', 'findings', 'suggestions'],
        additionalProperties: false,
      },
    }),
  ),
)

phase('Synthesize')
const usable = reviews.filter(Boolean)
const topRisks = usable
  .filter((review) => review.severity === 'high' || review.severity === 'critical')
  .map((review) => review.file)
const summary = await agent(
  `Summarize these audit results into a prioritized list. Files at high risk: ${topRisks.join(', ') || 'none'}.\n${JSON.stringify(usable)}`,
  { label: 'audit summary', phase: 'Synthesize' },
)

return { reviewed: usable.length, topRisks, summary }

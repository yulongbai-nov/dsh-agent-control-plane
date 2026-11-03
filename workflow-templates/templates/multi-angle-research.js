// 多角度调研：技术/产品/风险三路并行，最后综合。
// args: { question: string, angles?: string[] }
const question = args?.question
if (typeof question !== 'string' || !question.trim()) throw new Error('args.question is required')
const angles = Array.isArray(args?.angles) && args.angles.length ? args.angles : ['technical', 'product', 'risk']

phase('Research')
const findings = await parallel(
  angles.map((angleName) => () =>
    agent(
      `Research this question from a ${angleName} perspective: ${question}\nReturn: 3-5 findings, each with evidence and uncertainty. Mention what you could not verify.`,
      { label: `${angleName} research`, phase: 'Research' },
    ),
  ),
)

phase('Synthesis')
const synthesis = await agent(
  `Synthesize these ${angles.length} research angles into one answer for: ${question}\nSeparate established facts from unknowns.\n${JSON.stringify(findings)}`,
  { label: 'synthesis', phase: 'Synthesis' },
)
return { angles, findings: findings.filter(Boolean).length, synthesis }

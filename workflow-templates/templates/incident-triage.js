// 故障初筛：收集症状 → 列假设 → 逐条验证 → 最可能根因。
// args: { symptom: string, evidence?: string }
if (typeof args?.symptom !== 'string' || !args.symptom.trim()) throw new Error('args.symptom is required')

phase('Collect')
const facts = await agent(`Restate the incident and list the facts we actually know, separating them from guesses.\nSymptom: ${args.symptom}\nEvidence: ${args.evidence ?? ''}`, {
  label: 'collect facts',
  phase: 'Collect',
})

phase('Hypotheses')
const hypotheses = await agent(`Based on these facts, list 3-5 ranked hypotheses with the cheapest discriminating check for each.\n${facts}`, {
  label: 'hypotheses',
  phase: 'Hypotheses',
})

phase('Verify')
const checks = await parallel(
  [1, 2, 3].map((rank) => () =>
    agent(
      `For ranked hypothesis #${rank}, perform the cheapest discriminating check you can and report SUPPORTED / REFUTED / UNKNOWN with evidence.\nHypotheses:\n${hypotheses}`,
      { label: `verify #${rank}`, phase: 'Verify' },
    ),
  ),
)
return { facts, hypotheses, checks: checks.filter(Boolean) }

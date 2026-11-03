// PR 多视角评审：正确性/安全/测试三路独立评审，再给合并建议。
// args: { target: string (PR 描述/分支/diff 摘要), context?: string }
const target = args?.target
if (typeof target !== 'string' || !target.trim()) throw new Error('args.target is required (PR/变更描述)')

phase('Review')
const angle = (name, instruction) => () =>
  agent(`${instruction}\n\nChange under review:\n${target}\n\nContext: ${args?.context ?? ''}`, {
    label: `${name} review`,
    phase: 'Review',
  })
const reviews = await parallel([
  angle('correctness', 'Review this change for correctness bugs and edge cases. Return the top risks, each with file/line if visible.'),
  angle('security', 'Review this change for security and data-handling risks (injection, secrets, permissions). Return the top risks.'),
  angle('tests', 'Review this change for missing tests and behavior regressions. Return the most important missing cases.'),
])

phase('Verdict')
const verdict = await agent(
  `Read these three reviews and decide: MERGE / FIX_FIRST / BLOCK. List must-fix items for FIX_FIRST or BLOCK.\n${JSON.stringify(reviews)}`,
  { label: 'verdict', phase: 'Verdict' },
)
return { anglesReviewed: reviews.filter(Boolean).length, verdict }

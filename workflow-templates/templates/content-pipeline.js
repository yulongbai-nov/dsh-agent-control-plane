// 内容生产流水线：研究 → 初稿 → 编辑润色，阶段间无屏障。
// args: { topic: string, audience?: string, tone?: string }
if (typeof args?.topic !== 'string' || !args.topic.trim()) throw new Error('args.topic is required')

phase('Research')
const research = await agent(
  `Research the topic and produce a fact list with sources/uncertainty. Topic: ${args.topic}. Audience: ${args.audience ?? 'general'}`,
  { label: 'research', phase: 'Research' },
)

phase('Draft')
const draft = await agent(`Write a first draft for ${args.audience ?? 'general'} readers. Tone: ${args.tone ?? 'clear'}.\nResearch:\n${research}`, {
  label: 'draft',
  phase: 'Draft',
})

phase('Edit')
const edited = await agent(
  `Edit the draft: tighten structure, remove fluff, keep facts. Return the final text plus a one-line change summary.\nDraft:\n${draft}`,
  { label: 'edit', phase: 'Edit' },
)
return { topic: args.topic, edited }

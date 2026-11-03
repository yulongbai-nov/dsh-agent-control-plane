// 依赖升级：审计候选 → 评估破坏面 → 分步升级计划。
// args: { packages: string[], targetVersion?: string }
const packages = Array.isArray(args?.packages) ? args.packages : []
if (packages.length === 0) throw new Error('args.packages must be a non-empty array')

phase('Audit')
const audits = await parallel(
  packages.map((pkg) => () =>
    agent(
      `Audit upgrading ${pkg}${args?.targetVersion ? ` to ${args.targetVersion}` : ' to the latest compatible version'}. Report: breaking changes, affected call sites, required migrations.`,
      { label: `audit ${pkg}`, phase: 'Audit' },
    ),
  ),
)

phase('Plan')
const plan = await agent(
  `Produce an ordered upgrade plan (one package at a time), with verification steps and rollback for each step.\n${JSON.stringify(audits.filter(Boolean))}`,
  { label: 'upgrade plan', phase: 'Plan' },
)
return { planned: packages.length, plan }

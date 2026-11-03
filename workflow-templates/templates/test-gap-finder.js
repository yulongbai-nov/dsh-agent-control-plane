// 测试缺口扫描：按模块并行找未覆盖行为，汇总成优先级列表。
// args: { modules: string[], behaviorAreas?: string[] }
const modules = Array.isArray(args?.modules) ? args.modules : []
if (modules.length === 0) throw new Error('args.modules must be a non-empty array of module paths')

phase('Scan')
const scans = await parallel(
  modules.map((mod) => () =>
    agent(
      `Find untested behavior in ${mod}. List gaps as {area, why}^, most user-visible first. Do not modify code.`,
      { label: `scan ${mod}`, phase: 'Scan' },
    ),
  ),
)

phase('Rank')
const ranked = await agent(
  `Merge these test-gap scans into one prioritized table (P0/P1/P2) with a one-line rationale each.\n${JSON.stringify(scans.filter(Boolean))}`,
  { label: 'rank gaps', phase: 'Rank' },
)
return { scanned: modules.length, ranked }

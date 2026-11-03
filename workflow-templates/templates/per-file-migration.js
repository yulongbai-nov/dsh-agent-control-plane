// 逐文件迁移/重写：每个文件独立走 计划 → 修改 → 验证，无全局屏障。
// args: { files: string[], goal: string }
const files = Array.isArray(args?.files) ? args.files : []
const goal = args?.goal
if (files.length === 0) throw new Error('args.files must be a non-empty array')
if (typeof goal !== 'string' || !goal.trim()) throw new Error('args.goal is required')

phase('Migrate')
const results = await pipeline(
  files,
  (file) =>
    agent(`Plan the smallest change to ${file} for this goal: ${goal}. Return ordered steps and the exact edit boundaries.`, {
      label: `plan ${file}`,
    }),
  (plan, file) => agent(`Apply this plan to ${file}. Plan:\n${plan}\nOnly change what the plan requires.`, { label: `apply ${file}` }),
  (applied, file) => agent(`Verify ${file} after the change. Check the target behavior and report PASS/FAIL with evidence.`, {
    label: `verify ${file}`,
  }),
)

phase('Verify')
const failed = results
  .map((result, index) => ({ file: files[index], result }))
  .filter((entry) => !entry.result || /FAIL/i.test(entry.result))
return { migrated: results.filter(Boolean).length, failed }

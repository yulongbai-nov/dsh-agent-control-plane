# 剩余需求实现方案（R2 / R4 / R9 / R12 / R16 + 深化项）

> 基线：`DELIVERY.md` 的 v0.1（R7/R8/R13/R6 面已真机验收，R1/R3/R5/R10/R11/R15/R17/R18 部分）。
> 原则：继续"能复用就复用、只补缺口"；每个需求先给**最小可验收闭环**，再列后续增强。
> 工作量是单人工时估计，不含每 rc 维护。

## 优先级建议

| 顺序 | 需求 | 为什么 | 估时 | 依赖 |
|---|---|---|---|---|
| ~~1~~ | ~~R17 视觉/无障碍 + R18 导出/清除~~ | ✅ **已完成（2026-11-02）**：E2E 08/09 真机覆盖深浅色、locale、键盘、export/purge/重建 | — | — |
| 1 | R12 缓存面板 | 数据现成（`tokenUsage` 投影 + 遥测），只需要展示与验收 | 1–2 人日 | 无 |
| 3 | R4 自动建队 | 用户可见价值高；R6 每成员模型已具备 | 3–5 人日 | R6 ✅ |
| 4 | R16 utility 库 | 数据面依赖 R15，但最小 registry 可先做 | 3–4 人日 | R15 部分 |
| 5 | R2 团队级深度 | 需要包一层 spawn 门禁，语义要仔细 | 3–5 人日 | 无 |
| 6 | R10/R11 深化 | 先用 mock provider 造 workflow 运行，再对齐拓扑/看板 | 5–7 人日 | mock tool-call 扩展 |
| 7 | R9 任务驱动标题 | 最高风险：需要扩展/替换标题服务，公开 seam 不足 | 5–8 人日 | 上游 seam 或 fork |

---

## R17 视觉与无障碍（✅ 已完成基础版，2026-11-02）

- 已完成：`e2e/tests/08-visual-a11y.spec.mjs` —— 深色/浅色主题切换后会话树仍可见、中英 locale 切换、
  键盘 Enter 激活新建会话 / Tab 进树 / Enter 打开行菜单（真实 GUI）。
- 剩余：屏幕阅读器全量语义验收；窄屏/长名布局矩阵。


- **现状**：浅色主题截图有；深色、locale、键盘/读屏、窄屏未全量验收。
- **最小闭环**：E2E 增加 3 条用例——深色主题下会话树可读（切换 `data-theme` 后截图对比）、
  中英切换后侧栏文案变化、Tab/方向键/Enter 可完成「展开→选行→打开菜单」。
- **落点**：`e2e/tests/08-visual-a11y.spec.mjs`（Playwright 内切主题/语言 + 键盘操作），
  可选 `axe-core` 注入做基本 a11y 断言；不改产品代码。
- **验收**：3 条用例通过 + 深色/浅色截图；不做全量读屏，只覆盖会话树与插件页。

## R18 导出/清除/墓碑（✅ 已完成基础版，2026-11-02）

- 已完成：`e2e/tests/09-telemetry-lifecycle.spec.mjs` —— 导出 JSON 不含正文、purge 归零、
  新消息后 rows 恢复（真实 SQLite + 隔离路径）。
- 剩余：跨重启 tombstone 不复活、保留期策略的正式验收。


- **现状**：`dsh-local-telemetry` 已有 `--export` / `--purge` / `--status` / `--summary`。
- **最小闭环**：E2E 里新增一条：真实/ mock 会话后 `--export --format json` 产出可解析文件；
  `--purge --before 0s` 后再查询 count 归零；重启实例后不复活（墓碑语义）。
- **落点**：`e2e/tests/09-telemetry-lifecycle.spec.mjs`（node 侧 execFile，不依赖 GUI 交互）。
- **验收**：导出文件 JSON 合法且不含正文；purge 后 rows=0；重启后仍为 0。

## R12 缓存友好

- **现状**：`dsh-token-meter` 已给 `cacheReadTokens` / `uncachedInputTokens`；遥测已落库。
- **最小闭环**：一个 client 面板（可加进我们的 session-tree 插件或独立小插件）显示
  当前会话 cache 命中率、复用/新建对比；E2E 断言 mock provider 返回的 usage 中
  `cacheReadTokens>0` 时面板出现对应数字。
- **落点**：`third_party/dsh-session-tree` 增加一个 footer/摘要行，或独立 `dsh-control-plane-cache-panel`。
- **验收**：面板数字与 `sessionStats`/`tokenUsage` 一致；切换模型后提示"前缀可能失效"。

## R4 自动建队

- **现状**：官方 Team + `spawn_teammate_with_model` 可用；无"根据任务给建议并一键创建"。
- **最小闭环**：
  1. host 插件注册工具 `suggest_team(task, max=5)`：用结构化 prompt 让模型返回
     `[{role, why, provider, model, preset}]`（mock provider 在 E2E 里返回固定 JSON）。
  2. client 面板：列出建议 → 勾选 → 「创建团队」调用现有 `spawn_teammate_with_model`；
     支持撤销/取消。
  3. 权限：只有当前会话 owner 可创建；超上限/不支持模型显式拒绝。
- **落点**：新包 `packages/team-suggest/`（host tool + client panel），复用官方 Team 服务。
- **验收 E2E**：mock provider 固定建议 → 面板出现 2–5 条 → 确认后 roster 出现成员且模型正确 →
  取消不创建 → 超限/非法 provider 显示错误。

## R16 utility 库

- **现状**：无 registry / 晋升 / `run_utility`。
- **最小闭环**：
  1. host 插件维护 `~/.dsh/control-plane/utilities.json`（版本化、原子写）。
  2. 工具：`utility_promote(workflowId|source, name, inputSchema)`（需人工确认）、
     `run_utility(name, args)`（单入口，按注册版本执行受限脚本）、`utility_list`。
  3. 建议：先只基于"同一 workflow 运行次数 ≥ N"给候选，不自动晋升。
- **落点**：新包 `packages/utility-registry/`；执行复用 workflow 引擎，不新造调度。
- **验收 E2E**：promote → list 可见 → run 成功 → disable 后 run 显式拒绝 → 重启后 registry 一致。

## R2 团队级深度

- **现状**：原生 `subagent.maxDepth` 全局绝对深度；`spawn_teammate` 绕过它；无团队作用域。
- **最小闭环**：
  1. host 插件在 `ctx.agentTeams.spawnTeammate` 与 `ctx.subagents.startActivation/startContinuable`
     外面包一层门禁：按「全局默认 + 团队覆盖」计算允许深度，超限抛类型化错误。
  2. 团队覆盖存于插件自己的 store（按 team id），不做 roster 修改；Settings 面板改全局默认即时生效。
- **落点**：新包 `packages/team-depth/`；不改核心，失败即拒绝（fail-closed）。
- **验收 E2E**：mock provider 触发 4 层 spawn → 第 4 级返回 `DEPTH_EXCEEDED`；改全局设置后下一次
  spawn 立即生效；团队覆盖只影响本团队。

## R10/R11 深化（先用 mock 造真实运行）

- **关键工具**：给 mock provider 增加 `[[MOCK_TOOL:workflow]]` 场景，返回 OpenAI 工具调用
  （参数里带固定 workflow 脚本），让 DSH 真的执行 workflow 引擎、真的产生运行事件，
  再用 `dsh-workflow-map` / 我们仓库的拓扑模型对账。
- **步骤**：1) mock tool-call 扩展（0.5 人日）；2) 跑通一个两节点 workflow（1 人日）；
  3) 对照图/看板与事件（2–3 人日）；4) 失败/乱序/未知来源用例（1–2 人日）。
- **验收**：同一脚本两次运行渲染坐标一致；事件只改状态；未知来源标 unresolved，不猜。

## R9 任务驱动标题（最高风险，单独决策）

- **问题**：公开 seam 只在合格人类消息时派发；`register` 单例；`refresh()` 会解 pin；不能伪造消息。
- **三条路线**：
  A. **上游/开源源码 fork 标题服务**：从公开 rc.5 源码 fork `dsh-session-title`，加任务事件监听 +
     pin/并发/冷恢复门禁，作为 profile bundle 替换；涉及 TS 构建闭包（见 `docs/workspace-upstream-baseline.md`），
     估 5–8 人日且每 rc 需维护。
  B. **上游 Discussion 提 seam**：等官方提供"task-change 触发标题刷新"的公开接口；零 fork，但不可控。
  C. **降级展示**：不改标题，另做「会话备注/标签」（独立存储），明确标注不满足 R9。
- **建议**：先做 C 的 UI 占位（0.5 人日）并同时提 Discussion；只有在用户明确接受 fork 维护成本时才走 A。

---

## 依赖与顺序图

```
R6 ✅ ──> R4 ──> R16（复用成员/模型选择）
R15 部分 ──> R16
mock tool-call ──> R10/R11 深化
标题服务决策 ──> R9（C 降级可先行）
R17/R18/R12 独立，可直接开工
```

## 共同验收要求

- 每条需求至少：正例 + 反例/故障 + 重启恢复（适用时）+ 真机 GUI 证据。
- 新增测试只进 `e2e/`；只有修复 regression 才补最小单测。
- 模型层优先用 mock provider（零成本、确定性）；真实模型只用于最终验收的 1–2 条冒烟。

# 文档一致性审计（2026-11-02）

审计对象：`dsh-mocks/spec/DSH-控制面-spec-v0.2.md`、`dsh-mocks/handoff/NEW-SESSION-PROMPT.md`、
实现仓库全部 `docs/*.md` + `README.md` + 本次新增的 `DELIVERY.md` / `e2e/README.md` / `delivery/README.md`。

审计口径：**以 2026-11-02 的真机 E2E 结果和实际安装状态为准**。判定分四档：
`一致`、`过期`（事实已变但结论方向仍对）、`冲突`（会误导读者/后续会话）、`已弃用`（整份策略被用户新指示取代）。

## 0. 一句话结论

核心需求表（R1–R18）本身仍然有效；**过期/冲突集中在"状态类"文档**：spec 头、README 当前进度、
`docs/status.md`、`install-and-acceptance.md`、`upgrade-smoke.md`、`E2E-HANDOFF-PLAN.md`、handoff prompt。
本轮已给这些文件加上"2026-11-02 现状"声明或直接改写；单列的需求与设计章节保持原样，只补状态注记。

## 1. 逐文件审计

| 文件 | 关键声称 | 2026-11-02 现状 | 判定 | 本轮处理 |
|---|---|---|---|---|
| `spec v0.2` 头部 | "仅有开发原型与隔离内存测试，尚未安装、完成真实 GUI 验收或完成 R1–R18" | 5 个组件已装入独立 profile，真机 E2E 14/14（含真实模型），R7/R8/R13/R6 面已验收 | **冲突** | 改写头部状态行 |
| `spec v0.2` §3「现状与差距」 | 侧栏/标题/Team/Workflow 均为缺口 | 侧栏树、团队模型、workflow 地图、遥测已由插件覆盖；R2/R4/R9/R12/R16 仍是缺口 | **过期** | 追加「交付后现状」表，保留原表为 rc.5 原生能力基线 |
| `spec v0.2` §10 路线 | P1-spike / P1 从零实现；"合计 34–63 人日" | P1 的大部分由 vendor 插件完成；剩余工作量见 `docs/REMAINING-REQUIREMENTS-PLAN.md` | **过期** | 追加交付注记与剩余工作量口径 |
| `spec v0.2` §13 测试与验证 | 单元/集成/视觉三层，未提 mock provider/CI | 已落地：真机 GUI E2E、确定性 mock provider、录制回放、失败取证、CI 方案 | **过期** | 改写为当前测试策略 |
| `spec v0.2` §14 待决问题 | 6 条待决 | 第 1/4 条已被 mock provider + E2E 回答；第 2/3/5/6 条仍在 | **部分过期** | 逐条标注状态 |
| `spec v0.2` §15.3 评审表 | 列"立即做/验证后" | 与交付结果基本一致，无冲突 | 一致 | 不改 |
| `spec v0.2` §16 CR 回复 | 实现者回复待 Lead 复核 | CR-001–010 的事实仍成立；最终交付另见 `DELIVERY.md` | 一致 | 追加交付链接 |
| `dsh-mocks/handoff/NEW-SESSION-PROMPT.md` | "先离开调研阶段、开始实现"；要求 Astra 两轮审查 | 实现已交付；**用户已取消 Astra 审查要求**（`docs/install-and-acceptance.md` 有记录） | **已弃用** | 头部加"历史交接"声明 + 指向 `DELIVERY.md` |
| 实现仓库 `README.md` | "当前为开发阶段：尚未安装…没有完成 GUI 验收" | 已交付 v0.1 | **冲突** | 改写当前进度段 |
| `docs/status.md` | "无任何一项标记验收通过" | R7/R8/R13/R6 面已真机验收；其余见矩阵 | **冲突** | 整表改写为交付后状态 |
| `docs/architecture-decisions.md` | 001「独立主面板不是 R7」；002「R9 不可达」 | 001 结论仍对，但已用 **vendor 单槽替换** 解决；002 仍成立（R9 是缺口） | **过期（001）** | 顶部加状态注记 |
| `docs/install-and-acceptance.md` | "没有可执行安装或回滚命令"；VM 隔离前置 | `delivery/` 有安装/回滚/pack 并已闭环实测；VM 方案未采用 | **已弃用** | 头部标注被 `DELIVERY.md` 取代 |
| `docs/upgrade-smoke.md` | 全部未执行 | 升级冒烟现在可直接用 `node e2e/run-e2e.mjs --mock-model` + `--real-model` | **过期** | 头部加"当前可执行形态" |
| `docs/E2E-HANDOFF-PLAN.md` | 104 提交逐项回归 + 专用 VM 隔离 + 每提交证据 | 测试策略已被用户新指示取代：真机 + 行为 E2E + 只在 regression 加单测；VM 未创建 | **已弃用** | 头部标注"历史方案，不执行" |
| `docs/workspace-upstream-baseline.md` | 上游源码/构建闭包只读调查 | 仍准确 | 一致 | 不改 |
| `DELIVERY.md` / `e2e/README.md` / `delivery/README.md` | 本次交付 | 与实机一致 | 一致 | 新增 |

## 2. 发现的口径冲突（按严重度）

1. **"是否已验收"**：spec 头/README/status 三处都说"没有验收"，而实际已有真机 E2E 证据。后续会话若先读旧文档会重复劳动或误判。
2. **"怎么验收"**：`E2E-HANDOFF-PLAN.md` 要求 104 个历史提交逐个回归 + VM 隔离；用户已明确改为真机实测、只在 regression 补单测、要能上 CI。旧计划不再执行。
3. **"能不能装"**：`install-and-acceptance.md` 说没有可执行命令；实际 `delivery/install.mjs` 已闭环（装 5 组件 / 回滚恢复原 7 bundle）。
4. **"Astra 审查"**：handoff 仍要求两轮 Astra 审查；用户已取消，不应作为交付门槛。
5. **"R7 形态"**：架构决策 001 说只能自研主面板或大 fork；实际用 vendor 的 `sidebar.workspaces` 单槽替换就满足常驻侧栏，且已真机验证。
6. **"mock 能不能算验证"**：spec §13 说 mock 截图不算——正确；本次 mock provider 只替换**模型层**，GUI/Host 仍是真实组件，不与该条冲突，已在 §13 注记区分。

## 3. 仍有效、不需要改的文档

- `docs/architecture-decisions.md` 003（workflow 确定性 ≠ 动态图）、005（来源/持久性）、006（遥测披露边界）——仍正确，是 R10/R15/R18 后续实现的约束。
- `docs/workspace-upstream-baseline.md`、`dsh-mocks/research/*`、`dsh-mocks/session-tree/*`（mock 与调研）。
- 各 package README：研究原型仍是准确的历史记录，但**不再代表当前交付形态**（已在 README 顶部说明）。

## 4. 本轮实际改动

- 新增：本文件、`docs/REMAINING-REQUIREMENTS-PLAN.md`、`docs/TEST-INFRA.md`。
- 改写：`docs/status.md`（交付后状态 + 历史表保留在文末）。
- 头部注记：spec 头/§3/§10/§13/§14、handoff、README、architecture-decisions、install-and-acceptance、upgrade-smoke、E2E-HANDOFF-PLAN。
- 未改：需求正文（R1–R18 验收要点）、架构决策 003/005/006、上游基线、mock 与调研材料。

## 5. 仍需人工确认的点

1. spec 是否升版到 v0.3（本轮只加注记，不改需求正文；若确认则把"交付状态"并回正文）。
2. `docs/status.md` 中 R1–R18 的"验收通过"口径：本仓库采用"有真机 E2E 证据=该条通过"，与 spec §11 的完整验收标准（4 层证据）仍有差距，已在表中逐条注明。
3. 旧研究包（38 个）是否归档；本轮不删，避免破坏历史引用。

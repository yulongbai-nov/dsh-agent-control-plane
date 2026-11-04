# Workflow Authoring 方案汇总与决策清单

> 状态：讨论汇总（2026-11-04）。前序材料：`docs/WORKFLOW-AUTHORING-RESEARCH.md`、
> `prototype/inline-workflow-card.html`、`prototype/dag-canvas.html`、`prototype/dag-auto-layout.html`。
> 官方现状：硬 workflow 只有运行树（`dsh-client-ui-workflow-run`：run→phase→member，仅状态），
> 没有 DAG/画布/编辑；软 workflow（workflow-lite，MIT，实验版）有画布与运行状态。

## 0. 一句话方案

**本地优先、图为中心**：agent 和人编辑同一张工作流图；**软执行做日常迭代，硬编译做定稿执行**。
**视觉只保留官方运行树 + workflow-lite 自带画布**——不做我们自己的 DAG/内嵌卡片层（v2 决策，2026-11-04）。
不嵌 n8n、不碰宿主包。

## 1. 目标交互

```text
prompt → agent 建图 → 可视化 → 人审阅（框选/截图给精确 context）
      → 继续 prompt 迭代 / 人或 agent 手动改图 → 定稿 → 执行（软→硬）
```

关键点：**图是 source of truth**，硬脚本只是定稿后的产物；审查/注释都作用在图和运行记录上。

## 2. 软 vs 硬（已达成结论）

| | 软（workflow-lite） | 硬（官方 workflow 引擎） |
|---|---|---|
| 编译成 | 计划提示词 | JS 脚本（`agent/parallel/pipeline/phase/log/args`） |
| 执行 | 模型按计划执行 | PTC 引擎，确定性 fan-out/phase |
| 创作/迭代 | **强**：改图即改计划、无编译约束、秒级 | 弱：要 codegen + 校验，受 hooks 子集限制 |
| 确定性/审计/并发控制 | 弱 | **强** |
| 断点续跑 | 有（实例 + run state） | 无（引擎无 checkpoint） |
| 事件→画布步骤映射 | 自有 run state，天然对应 | 事件不带调用位置，并发下难绑定 |
| 团队/记忆/定时/画布展示 | 有（插件层） | 无 |

**结论**：软是创作层，硬是执行层；不二选一，同一张图两个编译目标。

## 3. 架构（三层）

```text
创作层（workflow-lite 画布：图 + 版本 + agent/人编辑）
   │  图 JSON（source of truth）
   ├── 软执行：图 → 计划提示词 → 模型执行（默认，日常迭代；画布内显示运行状态）
   └── 硬执行：图 → 兼容性检查 → 脚本 → 官方 workflow 工具（定稿/复现/审计）
视觉层（全部现成）：workflow-lite 画布（软运行状态）+ 官方 run→phase→member 运行树（硬运行）
注：不做我们的内嵌卡/DAG 渲染层（Q4/Q5/Q7 作废）。
```

组件：
- **workflow-lite**（已装 desktop profile 0.9.0，MIT）：画布、图存储、软编译、run state、版本、导出 Skill。
- **官方 workflow 工具/引擎**：硬执行、会话运行记录、`ui-workflow-run` 节点。
- **硬编译导出器**（唯一待建组件）：读 workflow-lite 的图 → 兼容性检查 → 生成官方 workflow 脚本；可做成小工具/CLI 或 workflow-lite 的扩展。
- 注释/框选 context：走**聊天附件/画布直接编辑**，不做自定义注解层。
- 复用库：`@xyflow/react`（画布）、`elkjs`（分层+正交边+交叉最小化）、`zod`、`zundo`、`acorn`、
  本仓库 `packages/workflow-topology`（脚本↔图）、`workflow-templates/`（硬模板）。

## 4. 已定决策

| 编号 | 决策 | 依据 |
|---|---|---|
| D-A | 本地优先插件，不嵌 n8n；需要集成时只做 bridge | n8n 是服务+SUL 许可+节点模型不同构（research 文档） |
| D-B | 软/硬分层：软默认创作，硬用于定稿执行 | 本轮结论；软灵活、硬确定 |
| D-C | 图为 source of truth，硬脚本为产物 | 用户交互目标：agent 改图、人审图、迭代 |
| D-D | 官方 `ui-workflow-run` 保留为权威运行记录，DAG 是叠加视图 | 官方已有运行树；不重复造记录 |
| D-E | 不改官方包/不碰 app.asar，全部 profile 插件交付 | 宿主签名与长期维护原则 |
| D-F | 仓库 PR-only + CI 门禁（static / mock E2E / package） | 已有工程约定 |
| D-G | workflow-lite 已装 desktop profile 试用，快照可回滚 | 已完成（PR 前试用） |
| D-H | 先本地后 CI、零成本官方 mock 优先，真实模型按需 | 预算约束 |
| D-I | ~~视觉方向：内嵌卡 + 展开 DAG~~ **（已被 D-J 取代）** | 3 个 mock 保留为设计存档（prototype/），不做实现 |
| D-J | **取消自研视觉层**：不做内嵌 DAG 卡片；视觉只保留 workflow-lite 画布 + 官方运行树 | 用户 2026-11-04 决定；减依赖/减风险 |

## 5. 待定决策（需要拍板）

| 编号 | 决策点 | 选项 | 建议 | 影响 |
|---|---|---|---|---|
| Q1 | 创作画布归谁 | A 扩展 workflow-lite（上游 PR / 依赖扩展） · B fork 内置 · C 自研薄插件自管图 | **A**（MIT、已有画布/图/运行态，最省） | 决定后续所有 UI 工作去向；实验版数据格式风险 |
| Q2 | 硬执行入口 | A 官方 `workflow` 工具（记录/节点免费，但脚本由模型转交、args 受限） · B 自研工具直接 `engine.start`（可控，但无官方记录，要自建视觉） | **A + 一键执行仍走官方工具** | 决定运行记录/视觉是否免费获得 |
| Q3 | 硬编译 v1 子集与不支持策略 | 支持：步骤/顺序/并行/phase/简单条件/有界循环/资源注入/args；不支持：任意 DAG（按层屏障）、动态条件、团队/记忆/定时/续跑。策略：警告/拒绝/软回退 | **兼容性检查 + 警告 + 可选回退** | 决定「冻结」按钮能否安全上线 |
| ~~Q4~~ | ~~布局/路由库~~ | — | **作废**（D-J 取消自研视觉层） | 省掉 ELK/dagre 依赖 |
| ~~Q5~~ | ~~视觉落点优先级~~ | — | **作废**（官方运行树 + workflow-lite 画布） | 少一个插件层 |
| Q6 | 注释/截图上下文载体 | A 聊天附件（截图/文件直接发） · B 手改画布节点/连线 · C 节点 data.annotations | **A+B**：不做注解层，agent 读聊天附件、人直接改画布 | 决定 agent 使用视觉 context 的方式 |
| ~~Q7~~ | ~~步骤↔事件映射~~ | — | **作废**（官方运行树不需要映射到画布） | 硬运行进度只看官方树 |
| Q8 | 断点续跑 | 硬不支持（整段重跑），长流程交软；或自建每步状态文件 | **接受硬不续跑，长流程用软** | 决定硬模式适用范围 |
| Q9 | v1 范围裁剪 | 团队模式/记忆/定时/n8n bridge 是否进 v1 | **全部 out of scope v1** | 控制工期与风险 |
| Q10 | 组件与打包边界 | 一个 authoring 插件 vs 视觉/编译/注释拆多个；与 workflow-lite 依赖关系 | **一个主插件 + 可选子模块；workflow-lite 作依赖不 fork（若可行）** | 后续维护/发布方式 |
| Q11 | 每步模型/工具配置 | 画布是否暴露 model/provider/tools（硬支持、软需注入 prompt） | **v1 不做** | 避免 v1 过重 |
| Q12 | 里程碑验收与预算 | P1 用 3–5 次真实模型调用验收？ | **可以，P1 验收控制在 5 次内** | 预算与节奏 |
| Q13 | 「冻结为硬 workflow」的入口 | A 纯聊天：你说一句，agent 生成并调官方工具跑 · B workflow-lite 画布加按钮（需扩展它） · C CLI | **A 起步**（零 UI 开发），B 作为后续增强 | 决定是否需要改 workflow-lite |

## 6. 路线图

| 阶段 | 内容 | 产出 | 估时 |
|---|---|---|---|
| P0 ✅ | 试用 workflow-lite、3 个 mock、官方节点验证、调研/缺口 | research 文档、prototype/、evidence | 已完成 |
| P1 | 创作闭环：聊天+pasted 截图/文本 context → agent 改图（`workflow_lite` 工具）→ 画布人工调整 → 软重跑 | 可跑通的人工审图迭代 demo | 1–2 天 |
| ~~P2~~ | ~~视觉层~~（取消，D-J） | — | — |
| P2' | 硬编译导出：兼容性检查 + codegen + 官方 workflow 工具执行（官方运行树免费获得） | 一句「冻结并执行」生成硬脚本并跑通 | 2–4 天 |
| P3 | 可选：n8n bridge / 团队 / 记忆 / 定时 | 按需 | — |

## 7. 风险

- 软执行依赖模型遵守计划，复杂流程可能跑偏；画布运行状态 + 人工纠偏兜底。
- 硬编译受 hooks 子集限制；无断点续跑；事件→步骤映射在并发/重复 label 下不保证。
- workflow-lite 实验版数据格式可能变化；若依赖它需跟版本。
- ELK 为 EPL-2.0（作依赖可用，别改源码闭源分发）；`@xyflow/react` 为 MIT。

## 8. 下一步需要你先拍板的 3 件事

1. **Q1 画布用法**：纯当依赖（零 UI 开发，硬导出做 companion 工具）· 扩展它（加冻结按钮）· 自研（否决）。
2. **Q2 硬执行入口**：官方 `workflow` 工具（记录/运行树免费）· 自研 `engine.start`（可控但无官方记录）。
3. **Q3 硬编译 v1 子集与不支持策略**（警告回退 / 直接拒绝）。

其余（Q6/Q8–Q13）可按建议默认推进，在里程碑验收时纠偏。

# Workflow Authoring 方案汇总与决策清单

> 状态：讨论汇总（2026-11-04）。前序材料：`docs/WORKFLOW-AUTHORING-RESEARCH.md`、
> `prototype/inline-workflow-card.html`、`prototype/dag-canvas.html`、`prototype/dag-auto-layout.html`。
> 官方现状：硬 workflow 只有运行树（`dsh-client-ui-workflow-run`：run→phase→member，仅状态），
> 没有 DAG/画布/编辑；软 workflow（workflow-lite，MIT，实验版）有画布与运行状态。

## 0. 一句话方案

**本地优先、图为中心**：agent 和人编辑同一张工作流图；**软执行做日常迭代，硬编译做定稿执行**；
官方运行记录 + 我们的 DAG 视觉层叠加；不嵌 n8n、不碰宿主包。

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
创作层（图 + 注释 + 版本 + agent/人编辑）
   │  图 JSON（source of truth）
   ├── 软执行：图 → 计划提示词 → 模型执行（默认，日常迭代）
   └── 硬执行：图 → 兼容性检查 → 脚本 → 官方 workflow 工具（定稿/复现/审计）
视觉层：消息流内嵌卡（折叠摘要）+ 展开 DAG（phase 泳道/正交边/动画）+ 官方运行树节点
```

组件：
- **workflow-lite**（已装 desktop profile 0.9.0，MIT）：画布、图存储、软编译、run state、版本、导出 Skill。
- **官方 workflow 工具/引擎**：硬执行、会话运行记录、`ui-workflow-run` 节点。
- **我们的创作/视觉插件**（待建）：DAG 视图、内嵌卡、注释（框选/截图）、硬编译与兼容性检查。
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
| D-I | 视觉方向：内嵌卡（折叠）+ 展开 DAG（phase/曼哈顿/跨线桥/动画） | 3 个 mock 已完成（prototype/） |

## 5. 待定决策（需要拍板）

| 编号 | 决策点 | 选项 | 建议 | 影响 |
|---|---|---|---|---|
| Q1 | 创作画布归谁 | A 扩展 workflow-lite（上游 PR / 依赖扩展） · B fork 内置 · C 自研薄插件自管图 | **A**（MIT、已有画布/图/运行态，最省） | 决定后续所有 UI 工作去向；实验版数据格式风险 |
| Q2 | 硬执行入口 | A 官方 `workflow` 工具（记录/节点免费，但脚本由模型转交、args 受限） · B 自研工具直接 `engine.start`（可控，但无官方记录，要自建视觉） | **A + 一键执行仍走官方工具** | 决定运行记录/视觉是否免费获得 |
| Q3 | 硬编译 v1 子集与不支持策略 | 支持：步骤/顺序/并行/phase/简单条件/有界循环/资源注入/args；不支持：任意 DAG（按层屏障）、动态条件、团队/记忆/定时/续跑。策略：警告/拒绝/软回退 | **兼容性检查 + 警告 + 可选回退** | 决定「冻结」按钮能否安全上线 |
| Q4 | 布局/路由库 | ELK（EPL-2.0，大，workflow-lite 已带） · dagre+自写曼哈顿（MIT，小） | 扩展 workflow-lite → **ELK**；自研 → dagre | 体积/许可/交叉质量 |
| Q5 | 视觉落点优先级 | A 消息流内嵌卡+展开 DAG · B 独立运行面板 · C 增强社区 dsh-workflow-map | **A** | 直接影响你日常审阅体验 |
| Q6 | 注释/截图上下文载体 | A 节点 data.annotations（可版本化/导出） · B 旁路文件 · C 临时塞 prompt | **A + 转成文本/图片资源给执行者** | 决定 agent 能否稳定消费你的框选/截图 |
| Q7 | 步骤↔事件映射约定 | 唯一 label（`stepId#attempt`）、fan-out 用 item 后缀、循环用轮次；v1 允许近似并标注 | **先单层 label 映射，复杂图警告** | 决定硬模式 DAG 进度能否和画布一致 |
| Q8 | 断点续跑 | 硬不支持（整段重跑），长流程交软；或自建每步状态文件 | **接受硬不续跑，长流程用软** | 决定硬模式适用范围 |
| Q9 | v1 范围裁剪 | 团队模式/记忆/定时/n8n bridge 是否进 v1 | **全部 out of scope v1** | 控制工期与风险 |
| Q10 | 组件与打包边界 | 一个 authoring 插件 vs 视觉/编译/注释拆多个；与 workflow-lite 依赖关系 | **一个主插件 + 可选子模块；workflow-lite 作依赖不 fork（若可行）** | 后续维护/发布方式 |
| Q11 | 每步模型/工具配置 | 画布是否暴露 model/provider/tools（硬支持、软需注入 prompt） | **v1 不做** | 避免 v1 过重 |
| Q12 | 里程碑验收与预算 | P1 用 3–5 次真实模型调用验收？ | **可以，P1 验收控制在 5 次内** | 预算与节奏 |

## 6. 路线图

| 阶段 | 内容 | 产出 | 估时 |
|---|---|---|---|
| P0 ✅ | 试用 workflow-lite、3 个 mock、官方节点验证、调研/缺口 | research 文档、prototype/、evidence | 已完成 |
| P1 | 创作闭环：框选/截图/文本注释 → agent 改图（`workflow_lite` 工具）→ diff → 软重跑 | 可跑通的人工审图迭代 demo | 1–2 天 |
| P2 | 视觉层：消息流内嵌卡 + 展开只读 DAG（数据源软 run state） | 真实数据的运行视图 | 1–2 天 |
| P3 | 硬编译：兼容性检查 + codegen + 官方工具执行 + 官方记录 + DAG 绑定 | 一键「冻结为硬 workflow」 | 3–5 天 |
| P4 | 可选：n8n bridge / 团队 / 记忆 / 定时 | 按需 | — |

## 7. 风险

- 软执行依赖模型遵守计划，复杂流程可能跑偏；需要运行状态/人工纠偏兜底。
- 硬编译受 hooks 子集限制；无断点续跑；事件→步骤映射在并发/重复 label 下不保证。
- workflow-lite 实验版数据格式可能变化；若依赖它需跟版本。
- ELK 为 EPL-2.0（作依赖可用，别改源码闭源分发）；`@xyflow/react` 为 MIT。

## 8. 下一步需要你先拍板的 3 件事

1. **Q1 创作画布归谁**（扩展 workflow-lite / fork / 自研）——最影响所有 UI 工作去向。
2. **Q2 硬执行入口**（官方工具 vs 自研引擎）——决定运行记录与视觉是否免费获得。
3. **Q3 硬编译 v1 子集与不支持策略**（警告回退 / 拒绝）——决定「冻结」按钮的产品边界。

其余可按建议默认推进，在 P1/P2 里程碑验收时纠偏。

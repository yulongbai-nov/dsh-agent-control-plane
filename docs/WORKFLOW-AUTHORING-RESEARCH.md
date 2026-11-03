# n8n 式 workflow authoring：路线调研与建议

结论先行：**不要嵌入 n8n**；做**本地优先的 DSH 客户端插件**（画布 + 本地图文件 + 无服务器），
用现成库解决 80%（React Flow + ELK），执行层复用 DSH 官方 `workflow` 引擎。短期先用
`@xiaoso/dsh-workflow-lite` 试手（MIT，已装在本机 desktop profile）。

## 1. n8n 能不能直接做成插件？

| 维度 | n8n 现状 | 对 DSH 插件的影响 |
|---|---|---|
| 架构 | 常驻 Node 服务 + DB（SQLite/Postgres）+ Redis（queue 模式）+ 自带前端编辑器 | 不是可嵌入组件；要跑就得再部署一套服务，和「本地优先、不需要服务器」相反 |
| 许可 | Sustainable Use License（fair-code，非 OSI 认证）；自托管内部使用免费，但限制把它的功能转售/托管为服务 | 嵌入/再分发有法务约束；不能当普通 MIT 依赖用 |
| 编辑器 | n8n 自己的节点画布（Vue Flow 体系）+ 400+ 集成节点 | 节点模型是 n8n 的（trigger/credential/webhook），和 DSH 的 agent/subagent/tool 模型不同构 |
| 可复用部分 | 触发模型、节点 UI 思路、webhook/REST API | 适合做 **bridge**（DSH → n8n），不适合做 authoring 内核 |

如果已经有 n8n 服务器，做「DSH 触发 n8n 并回显运行」的小插件是最省事的；但 authoring（画布
编辑、版本、运行观察）仍应留在 DSH 侧，否则要维护两套模型。

## 2. 三条路线

| 路线 | 是什么 | 优点 | 缺点 | 何时选 |
|---|---|---|---|---|
| A. n8n bridge | DSH 插件调用 n8n REST/webhook，看运行状态 | 1 天级；直接复用 n8n 集成生态 | 需要 n8n 服务器；图仍不是本地资产；两套模型 | 已有集中式 n8n、重度集成需求 |
| B1. 本地软工作流 | 画布图 → 编译成「计划提示词」→ 模型按计划执行（workflow-lite 的做法） | 最灵活：任意分支/循环/条件；无新引擎；图与提示词都是本地文件 | 执行是模型遵守计划，非确定性；复杂流程要模型自律 | 快速试手、人类主导的流程 |
| B2. 本地硬 DAG | 画布图 → 代码生成成官方 `workflow` 脚本 → `ctx.workflowEngine` 执行（PTC 引擎） | 确定性 fan-out/phase、可持久事件、与官方 workflow 工具/模板库同构 | 图必须落在官方 hooks 子集内（agent/parallel/pipeline/phase/log/args）；代码生成与校验要写 | 生产级、要可重复执行/审计 |
| B3. 混合 | 同一条图，可编译成两种后端（软计划 / 硬脚本） | 试错用软、固化用硬；渐进升级 | 编译器要维护两条路径 | 推荐终态（B1 起步，B2 增量） |

**推荐终态 B3**：画布与图格式自研/复用，执行层复用官方引擎；不要在 DSH 里重造执行引擎，
也不要把 n8n 当内核。

## 3. 现成库（能用就不写）

| 能力 | 推荐 | 许可 | 备注 |
|---|---|---|---|
| 节点画布 | `@xyflow/react`（React Flow 12） | MIT | React 19 可用；n8n/workflow-lite 同源思路；受控 nodes/edges + 自定义节点 |
| 自动布局 | `elkjs`（ELK layered） | MIT | 分层布局、端口/正交边可选；比 dagre 更经得起大图 |
| 画布 UI 组件 | shadcn/ui、Radix、lucide | MIT | 工具栏、面板、菜单 |
| schema / 校验 | `zod` | MIT | 图文件、节点 data、导入导出校验 |
| 撤销/重做 | `zundo`（zustand 中间件） | MIT | 画布编辑历史 |
| 图→代码校验 | `acorn` | MIT | 生成的脚本先 parse 再交给引擎 |
| 代码节点编辑 | `@monaco-editor/react` 或 CodeMirror 6 | MIT | 可选，给高级节点写 JS |
| 执行/观察 | DSH 官方 `workflow` 工具 + `ctx.workflowEngine`；已装 `dsh-workflow-map` 看运行图 | — | 我们的 `workflow-templates/` 可直接作为节点库来源 |
| 脚本↔图 | 本仓库 `packages/workflow-topology`（保守静态分析 + 确定性布局） | MIT | 把已有 workflow 脚本反向画成图，做「导入脚本」入口 |

## 4. 候选插件对比（都能直接装）

| | `@xiaoso/dsh-workflow-lite` | `GZX2211/dsh-Visual-Workflow` | 自研薄插件 |
|---|---|---|---|
| 模型 | 软工作流：画布→计划提示词→模型执行 | 完整平台：固定 DAG + 元编排 + 团队 + 定时 + API 服务模式 | 画布→（软/硬）编译 |
| 依赖 | `@xyflow/react`、`elkjs`、`markdown-it` | `@huggingface/transformers`（较重） | 复用上述库 |
| 许可 | MIT（发布物含第三方，见 THIRD_PARTY_NOTICES） | MIT | MIT |
| 成熟度 | 实验阶段，数据格式可能变 | 0.10.3，功能多、面大，含 REST 服务/多租户 | 需要自己维护 |
| 适合 | 立刻试手、人类主导的流程 | 想要完整 n8n 式平台（服务器模式） | 终态（可控、与官方引擎同构） |
| 风险 | 软执行不确定；数据格式变动 | 面大、HF 依赖、后台服务与 profile 复杂度 | 开发成本 2–4 周起 |

## 5. 建议的落地顺序

1. **现在（已完成）**：desktop profile 装 `dsh-workflow-lite` 试用；用自带 `review-demo` 图验证画布/运行/反馈。
2. **若试用手感 OK**：以 MIT 代码为参照，做「硬 DAG 编译」后端：画布节点 → 官方 `workflow` 脚本
   （`meta` + `agent/parallel/pipeline/phase/log/args`），用 `workflow-topology` 做反向导入与校验；
   复用 `workflow-templates/` 当节点模板。工作量 1–2 周，不需要新服务。
3. **需要 n8n 集成时**：加一个可选 bridge（webhook 触发 + 运行回显），不把 authoring 搬到 n8n。
4. **不建议**：fork n8n 编辑器或把 n8n 塞进插件（许可 + 服务 + 模型不同构）。

## 6. 试用安装记录（本机 desktop profile）

- 安装：`dsh plugin --profile desktop add @xiaoso/dsh-workflow-lite`（v0.9.0，MIT）
- 快照（出问题回滚用）：`~/.dsh/backups/desktop-workflow-lite-<时间>/`（package.json / pnpm-lock / cordis.patch.yml）
- 回滚：`dsh plugin --profile desktop remove @xiaoso/dsh-workflow-lite`，或把快照的 package.json 覆盖回去后重启
- 入口：会话页顶部 **Workflow** 标签；示例图 `review-demo`（收集→独立审查→fail 修复回环→pass 出结论）
- 说明：插件为实验版本，升级时图数据格式可能不兼容；生产用途前先评估。

## 7. 需要你反馈的问题

1. 画布编辑手感 vs n8n：缺什么（节点类型、分组、复制粘贴、快捷键）？
2. 执行方式：要「模型按计划执行」（软）还是「确定性 DAG」（硬）？还是两者都要？
3. 需要 n8n 的 400+ 集成节点吗（比如 HTTP/数据库/Slack）？这决定是否加 bridge。
4. 团队/定时/API 服务这些重功能，现在要吗，还是先只做画布 + 本地运行？

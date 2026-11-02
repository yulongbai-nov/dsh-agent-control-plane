# R1–R18 实现与验收状态

> **2026-11-02 交付后状态。** 需求真源仍是 [v0.2 spec](../../dsh-mocks/spec/DSH-控制面-spec-v0.2.md)，
> 本表只登记"当前仓库交付物"的状态。判定口径：✅ 有真机 E2E 证据；🟡 部分（已安装/可用，但验收不完整）；
> 🔴 未实现。**旧表（2026-11-01，交付前）保留在文末作为历史快照。**

## 当前交付物（v0.1）

| 需求 | 交付形态 | 真机证据 | 状态 |
|---|---|---|---|
| R1 递归团队 | `dsh-agent-teams-model-override`（pinned git） | 工具对 agent 可见（`TOOL_YES`）；未跑 L0→L3 全链 | 🟡 |
| R2 团队级深度 | 无（仅原生全局 maxDepth） | — | 🔴 |
| R3 手动建队 | 官方 Agent Team 面板 + 每成员模型创建工具 | 插件加载、Plugins 页可见 | 🟡 |
| R4 自动建队 | 无 | — | 🔴 |
| R5 归档与唤醒 | 官方归档 + 插件冷恢复 | 未做归档期拒绝语义 E2E | 🟡 |
| R6 Agent Spec | 同 R1 组件（provider/model/effort） | 工具可见性实测；真实 spawn 未在 E2E 发起 | 🟢 面 |
| R7 常驻侧栏树 | `third_party/dsh-session-tree`（vendor + 头像层） | E2E：树渲染、折叠、筛选、行菜单 | ✅ |
| R8 六类头像 | 同上 | E2E：推断、手动覆盖、刷新持久、恢复自动 | ✅ |
| R9 任务驱动标题 | 无 | — | 🔴 |
| R10 workflow 图 | `dsh-workflow-map@1.0.0` | E2E：入口可用、不崩溃、可回会话 | 🟡 |
| R11 节点看板 | 同 R10（地图内节点/进度） | 未验双向联动 | 🟡 |
| R12 缓存友好 | 无（遥测可见 cache 指标） | — | 🔴 |
| R13 安装/升级/回滚 | `delivery/` + `dshmarket` | 装 5 组件→回滚恢复原 7 bundle 实测；E2E 插件页 | ✅ |
| R14 权限默认 | 未改动 | 文档说明（用户已放弃自动审查默认） | ⚪ |
| R15 workflow 统计 | `dsh-local-telemetry`（部分） | 遥测落库 rows>0 | 🟡 |
| R16 utility 库 | 无 | — | 🔴 |
| R17 视觉/无障碍 | 各插件沿用官方 token | E2E：深色/浅色、中英 locale、键盘 Enter/Tab | ✅ 基础 |
| R18 本地遥测 | `dsh-local-telemetry@0.2.1` | E2E：落库、导出无正文、purge 归零、重建 | ✅ 基础 |

**E2E 汇总（20 条用例）**：默认 14 passed / 6 skipped（零模型调用）；`--mock-model` 16 passed / 4 skipped（官方 Messages mock，CI）；`--real-model` 17 passed / 3 skipped（2 次真实调用）；用户数据隔离审计通过。详见 `DELIVERY.md`。

## 本轮（v0.1）交付边界

- 已安装到独立 `e2e` profile 并真机验收；**未改动** `desktop` profile、签名 app、用户会话。
- 组件全部固定版本/commit；第三方均为 MIT、无外部网络依赖（调研见 `DELIVERY.md`）。
- 未做：R2/R4/R9/R12/R16；深化方案见 [REMAINING-REQUIREMENTS-PLAN.md](REMAINING-REQUIREMENTS-PLAN.md)。

---

## 历史状态（2026-11-01，交付前快照）

截至 2026-11-01，需求真源是相邻 [v0.2 spec](../../dsh-mocks/spec/DSH-控制面-spec-v0.2.md)；这里仅登记实现与证据，不复制或放宽验收要求。状态含义：**未开始**＝尚无对应实现；**原型**＝有局部代码或合成实验，不能替代实际功能；**待验证**＝实现已具备需真实运行验收；**验收通过**＝完整实现且所需端到端验收有证据。单个通过的合成测试不能提升整项状态；以下无任何一项标记验收通过。文档或测试可能在本表之后更新，检查最新提交和 spec。

| 需求 | 对应 package / 当前形态 | 已有证据（不是 GUI 验收） | 状态与主要缺口 |
|---|---|---|---|
| R1 递归团队 | 无团队实现包 | [原始深度调研](../../dsh-mocks/research/depth.md)是现状分析，不是本仓库实现或验收 | 未开始：团队 L0–L3、L4 类型化拒绝及恢复未实现 |
| R2 团队级深度 | [Agent Spec 预检](../packages/agent-spec/README.md)只输出 unknown | `node --test packages/agent-spec/test/*.test.mjs` 合成字段能力测试；不得将 `subagentDepth` 当相对预算 | 原型：没有团队范围设置与覆盖多条路径的原子门禁 |
| R3 手动建队 | [TeamService 接缝研究](../packages/team-control-spike/README.md) | 历史试验曾用安装版服务和内存替身观察字段未透传，但运行时未强制校验组件身份，非当前版本保证；不是完整 Host 或 UI | 原型：成员、模型、工具集选择及真实 roster 写入尚未扩展 |
| R4 自动建队 | 无团队实现包 | 尚无自动角色建议或一键创建的实现测试 | 未开始：建议、确认、撤销和权限未实现 |
| R5 归档与唤醒 | [Team 门禁参考模型](../packages/team-control-spike/README.md) | `node --test packages/team-control-spike/test/gate.test.cjs` 验证单 owner 内存模型，不接原生服务 | 原型：显式消息拒绝、同 ID 唤醒及持久恢复没有接入；隐藏不等于归档 |
| R6 Agent Spec | [Agent Spec 预检](../packages/agent-spec/README.md) | `node --test packages/agent-spec/test/*.test.mjs`；静态子集的结果仍是 unknown | 原型：未接 Team/workflow、工具集、授权或递归预算，未知后端不透传 |
| R7 常驻侧栏树 | [会话树主面板](../packages/session-tree/README.md)、[侧栏候选研究](../packages/workspace-sidebar-spike/README.md) | `node --test packages/session-tree/test/*.test.mjs packages/workspace-sidebar-spike/test/*.test.mjs` 是合成测试，不是 GUI | 原型：主面板不是最终侧栏；公开上游源码存在但 fork/构建/真实 GUI 未实现或验收 |
| R8 六类任务头像及覆盖 | [会话树主面板](../packages/session-tree/README.md) | 原型内置头像和浏览器 localStorage 覆盖；`node --test packages/session-tree/test/*.test.mjs` | 原型：与侧栏、可靠任务类型、持久策略及真实 GUI 尚未整体验收 |
| R9 随任务更新标题 | [标题服务负例](../packages/task-title/README.md#r9-合法接缝调查rc5)、[调度模型](../packages/task-title-service-spike/README.md) | rc.5 合成会话负例和 `node --test packages/task-title-service-spike/test/*.test.mjs` 合成状态机测试 | 原型：公开 seam 无法证明满足 pin、任务触发和冷恢复；备注/标签只是未实现的降级，不满足 R9 |
| R10 工作流图与编辑 | [拓扑](../packages/workflow-topology/README.md)、[字面量预览](../packages/workflow-literal-editor/README.md) | `NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" npm run test:workflow`；合成静态解析、布局和受限 diff | 原型：真实来源未认证，args/meta 编辑、真实 meta/宿主对账和授权重跑未实现 |
| R11 节点看板 | [投影](../packages/workflow-board-projection/README.md)、[客户端](../packages/workflow-board-client/README.md) | `node --test packages/workflow-board-projection/test/*.test.cjs packages/workflow-board-client/test/*.test.mjs`，合成事件与 React 替身 | 原型：未接实时宿主、完整用量及原生 GUI；歧义不猜映射 |
| R12 缓存友好 | 无专门的缓存策略实现包 | spec 参考历史调研；本仓库无真实 session 的 cache hit 验收 | 未开始：复用策略、冻结身份和命中率面板未实现 |
| R13 外部插件与可升级路线 | [会话树包](../packages/session-tree/README.md)、[安装及回滚门槛](install-and-acceptance.md) | 版本 pin 与有限内存冒烟；当前没有完整可验收产品包 | 原型：安装、真实 GUI、卸载、升级及失败回滚均未验收 |
| R14 不设自动审查默认 | 当前无默认权限配置修改 | [安装安全门槛](install-and-acceptance.md#0-进入安装测试前的硬门槛)规定变更需单独授权 | 待验证：项目无相应变更，但未验证任何未来安装后的默认权限 |
| R15 workflow 累积统计 | [建议规则](../packages/workflow-recommendation/README.md)、[遥测内存原型](../packages/personal-telemetry/README.md) | `node --test packages/workflow-recommendation/test/*.test.mjs packages/personal-telemetry/test/*.test.mjs` | 原型：缺可信 run/source 身份、按调用归因、持久重建和受权查询 |
| R16 utility 库 | [建议规则](../packages/workflow-recommendation/README.md)仅针对合成聚合 | `node --test packages/workflow-recommendation/test/*.test.mjs`；有不确定数据返回 unknown | 原型：没有人工晋升、版本化 registry 或 `run_utility` |
| R17 官方视觉及交互 | [会话树](../packages/session-tree/README.md)、[看板](../packages/workflow-board-client/README.md) | token/locale 与键盘行为的代码和合成替身测试 | 原型：实际 GUI 明暗对照、locale、键盘/辅助技术与 console 均未验收 |
| R18 本地个人遥测 | [内存原型](../packages/personal-telemetry/README.md)、[最小可用契约](../packages/personal-telemetry/MINIMAL-USABLE.md) | `node --test packages/personal-telemetry/test/*.test.mjs`；仅 `:memory:` 合成数据 | 原型：没有持久库、历史回填、授权、tombstone、导出/清除或真实源 durable cut |

## 横向证据和门槛

- `NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" npm test` 运行基础套件；不设 Acorn 路径时部分解析用例会明确 skip。实际通过数以本次命令输出为准，不用历史计数冒充当前结果。
- [来源工具研究](../packages/workflow-tool-spike/README.md)只给 unverified 候选；真实 rc.5 合成实体因 Session.id 是 getter 而没有候选，不能部署。无法从未可信绑定的旧记录恢复来源。
- [隔离 GUI 前置检查](../packages/sandbox-e2e/README.md)尚未满足。mock、无浏览器的内存服务测试、文档清单和测试截图均不能算作端到端验收；真实用户 GUI 未被修改。
- [升级冒烟清单](upgrade-smoke.md)和 [安装回滚清单](install-and-acceptance.md)是未来模板，不是已演练的运行指令。

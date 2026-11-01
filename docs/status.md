# R1–R18 实现与验收状态（CR-002）

截至 2026-11-01，需求真源是相邻 [v0.2 spec](../../dsh-mocks/spec/DSH-控制面-spec-v0.2.md)；这里仅登记实现与证据，不复制或放宽验收要求。状态含义：**未开始**＝尚无对应实现；**原型**＝有局部代码或合成实验，不能替代实际功能；**待验证**＝实现已具备需真实运行验收；**验收通过**＝完整实现且所需端到端验收有证据。单个通过的合成测试不能提升整项状态；以下无任何一项标记验收通过。文档或测试可能在本表之后更新，检查最新提交和 spec。

| 需求 | 对应 package / 当前形态 | 已有证据（不是 GUI 验收） | 状态与主要缺口 |
|---|---|---|---|
| R1 递归团队 | 无团队实现包 | [原始深度调研](../../dsh-mocks/research/depth.md)是现状分析，不是本仓库实现或验收 | 未开始：团队 L0–L3、L4 类型化拒绝及恢复未实现 |
| R2 团队级深度 | [Agent Spec 预检](../packages/agent-spec/README.md)只输出 unknown | `node --test packages/agent-spec/test/*.test.mjs` 合成字段能力测试；不得将 `subagentDepth` 当相对预算 | 原型：没有团队范围设置与覆盖多条路径的原子门禁 |
| R3 手动建队 | [TeamService 接缝研究](../packages/team-control-spike/README.md) | `test/rc5.baseline.cjs` 用真实服务和内存替身验证字段未透传；不是完整 Host 或 UI | 原型：成员、模型、工具集选择及真实 roster 写入尚未扩展 |
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

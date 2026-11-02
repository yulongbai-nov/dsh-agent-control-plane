# packages/ — 历史研究包（不参与交付）

这里保留了交付前的 38 个原型/调研包：会话树原型、标题服务研究、团队门禁模型、workflow 拓扑/看板、
遥测内存原型、隔离 sandbox 研究等。它们是设计过程的证据，**不是当前交付物**。

当前交付物在：

- `third_party/dsh-session-tree/` — vendored 侧栏树 + 头像
- `delivery/` — 安装/回滚/打包
- `e2e/` — 真机行为 E2E
- 外部插件：`dsh-agent-teams-model-override`、`dsh-workflow-map`、`dsh-local-telemetry`、`dshmarket`

规则：

- 不要从这些包里直接安装或引用到 profile；它们没有 `dsh.bundle` 清单，也没有真机验收。
- 修复 regression 时优先在交付路径（`third_party/`、`e2e/`、`delivery/`）改。
- 如需删除/归档旧包，先开 issue 讨论（保留历史对审计有价值）。
- 根 `npm test` 中的 27 个红测试集中在 `packages/synthetic-telemetry-ledger`（研究包），不作为 CI 门禁；
  修复前不要把它当回归信号。

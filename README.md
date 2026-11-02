# DSH Agent 控制面

> **交付状态（2026-11-02）**：控制面已组装完成并通过真机 E2E（14/14，含真实模型调用），
> 安装/回滚/打包见 [DELIVERY.md](DELIVERY.md)，E2E 套件见 [e2e/README.md](e2e/README.md)。
> 以下内容保留为历史调研记录；`docs/status.md` 是交付前的状态。


独立开发仓库，目标是在不修改签名应用的前提下实现会话树、动态团队和可视化工作流。当前为开发阶段：**尚未安装到 DSH，也没有完成 GUI 验收**。

## 当前进度

- [会话树实验包](packages/session-tree/README.md)：独立主面板，支持逐层加载、导航、六种头像和键盘操作；不是聊天时常驻的侧边栏树。另有[侧栏候选冲突研究](packages/workspace-sidebar-spike/README.md)和[公开源码基线调查](docs/workspace-upstream-baseline.md)；它们不是可安装 fork，R7/R8 尚未验收。
- [标题 provider 原型](packages/task-title/README.md)：只在现有的人类消息调度下读取团队任务，不能仅因任务变化刷新标题；与原 provider 互斥，不建议安装。[任务标题调度模型](packages/task-title-service-spike/README.md)仅是合成内存研究，不写原生日志，R9 未完成。
- [团队控制研究](packages/team-control-spike/README.md)只测试原生服务的合成替身装配和独立门禁模型，未接入真正的创建、归档或消息入口；团队相关要求尚未实现。
- [工作流拓扑核心](packages/workflow-topology/README.md)：保守静态分析并生成确定性布局，不执行脚本；[字面量编辑原型](packages/workflow-literal-editor/README.md) 只预览受限脚本的单处 diff；[运行事件投影](packages/workflow-board-projection/README.md) 只在来源有独立证明时匹配，歧义保留 unmatched；[工作流看板组件](packages/workflow-board-client/README.md) 可渲染静态图、节点表与事件。[来源候选观察器](packages/workflow-source-observer/README.md) 的结果始终未经认证；[合成来源关系模型](packages/workflow-provenance-model/README.md)也不提供认证或生产桥；[工具 fork 研究](packages/workflow-tool-spike/README.md)在真实 rc.5 合成实体中不能产生候选，不可部署；[内存 companion](packages/workflow-records-memory/README.md)不代表持久化或授权。它们尚未接入实时宿主/GUI，R10/R11 未完成。
- [Agent Spec 静态预检原型](packages/agent-spec/README.md) 只筛选已知字段与后端能力；不证明运行时路由、权限或递归预算，R6 未完成。
- [本地遥测内存原型](packages/personal-telemetry/README.md) 仅对合成数据验证 SQLite 数值快照与幂等事务；没有磁盘数据库、真实数据接入或报表，R18 未完成。[晋升建议原型](packages/workflow-recommendation/README.md) 只在调用方断言完整的合成聚合上给条件性建议，不执行晋升，不代表 R15/R16 已完成。
- [rc.5 隔离内存冒烟](packages/sandbox-smoke/README.md) 加载安装版 Cordis、模块加载器、slot 与会话投影，使用测试替身而非真实 GUI；[GUI 隔离前置检查](packages/sandbox-e2e/README.md) 尚未满足安全门槛。两者及只读版本/标记检查均不能代替端到端验收；团队功能尚未实现。

逐条进展见 [R1–R18 状态表](docs/status.md)，关键实现假设修正在 [设计决策](docs/architecture-decisions.md)。原始规格、mock 与调研在相邻目录 `../dsh-mocks/`；[全提交回归与真实 E2E 交接计划](docs/E2E-HANDOFF-PLAN.md)、[安装验收](docs/install-and-acceptance.md)与[升级回退](docs/upgrade-smoke.md)目前只是未经演练的未来清单。

## 检查

需要 Node.js 24；不需要安装依赖即可运行基础检查（含侧栏候选、标题调度、团队门禁、Agent Spec、拓扑布局、编辑预览、运行投影、看板、来源候选、companion 内存记录、晋升建议、遥测内存原型及隔离测试的纯测试；不包括完整解析器和 Electron 集成测试）。缺少 Acorn 时，编辑器解析用例及跨包解析互操作用例会显式跳过：

```bash
npm test
npm run compat -- '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
```

完整拓扑解析及编辑预览测试需要 Acorn 8；在此机器上可仅为进程引用已存在的模块，无需安装：

```bash
NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" npm run test:workflow
```

使用已安装 Electron 只读加载真实 rc.5 会话标题服务的可选集成测试，见 [标题原型测试说明](packages/task-title/README.md#构建测试与未来集成)。

版本与标记检查只读取本机文件，不修改 profile 或 app.asar。后续真正安装、替换标题 provider 或修改用户配置之前，须先征得用户同意；现有 GUI 的只读检查不需要改配置。未经验证的功能不会标为完成。

## 缓存与复用

跟进同一任务时优先复用 teammate 的现有会话；独立短任务可新建。复用时保持 provider、model、effort、preset 和工具集稳定，避免前缀失效；缓存命中与保留时间由服务商决定，不能保证。普通 session 归档不等于成员级归档，子会话被归档后不能假设消息会正常唤醒。

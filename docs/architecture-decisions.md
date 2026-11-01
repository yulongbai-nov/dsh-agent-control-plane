# 设计决策与范围修正

基线：本机打包版 DSH `0.2.1-rc.5`；不修改签名应用包、核心源码或用户 profile。版本检查与源代码标记只识别明显漂移，不能代替运行时或 GUI 验收。

## 001 · 面板入口不是侧边栏内容

规格 v0.1 将 `sidebar.panellist` 误认为可容纳持续显示的侧边栏内容。rc.5 的 `dsh-client-ui-sidebar/README.zh.md`「全局面板入口」明确：它仅注册图标、标签和 id；同 id 的 `main` keyed slot 才放主区域。真正的侧栏 workspace/session 浏览器是 `sidebar.workspaces` **single** slot，由 `dsh-client-ui-workspace` 填充。单独的主面板能验证树数据与导航，但不满足 R7 的「侧边栏会话树」。

**CR-003 决策：独立主面板只作可卸载原型，不是 R7 最终交付。** rc.5 的 `sidebar.workspaces` 为 single slot，外部插件没有已验证的可恢复组合/嵌入 seam；单纯覆盖会替换原生 Workspace 浏览器，不能称为无损叠加。当前选定的候选实现是以官方 `ui-workspace` 为基线做版本锁定的小范围 fork，在原列表中合并会话树、保留原生逻辑，并提供明确的禁用和回退；上游若先提供可组合 slot，则优先复用该公开 seam。尚未构建该 fork，也未证明它可安装、可回退或经过许可及官方版本升级验证；必须在隔离环境验证搜索、排序、工作区过滤、归档、权限、深层树、焦点/键盘、暗色和卸载恢复。不得通过侵入 DOM 或无提示抢占 single slot。

## 002 · 单一标题提供方并非可直接替换

rc.5 的 `dsh-session-title/README.zh.md`「提供方」及实现明确：已有 provider 时 `register()` 立即抛错，而不是替换。卸载现有提供方属于配置变更，须征得用户同意；本仓库不会执行。`refresh()` 是显式解除用户固定标题的操作，后台自动更新不得使用；`rename()` 会创建用户固定标题，也不得冒充自动更新。

自动 provider 派发只认合格的人类 `user/message`，还要匹配请求路由。子代理任务或工具事件本身不会触发，因而注册 provider 不能单独满足 R9。**CR-004 结论：现有公开服务在不修改/扩展标题服务时没有可证明满足「任务变化 ≤1 回合且保留 pin」的路径；现有原型不能冒充完成。** 先继续保留官方按用户消息生成标题的行为；如要提供任务主题，可另做明确标为「会话备注/标签」的可选展示（独立存储、授权与未实现），不得写 `session/title`、伪造用户消息或解钉。该降级只改善展示，不满足原 R9，最终仍需 [标题服务扩展设计](../packages/task-title/README.md#最小可行上游外置-fork-方向设计未实现) 中的授权、来源、pin、并发及冷恢复门禁，或用户明确更改目标。

## 003 · 确定性工作流结构不能等同于动态实际图

工作流脚本是 JavaScript，静态分析必须保守处理变量、循环、动态调用和 `pipeline` 未知输入；不执行用户脚本来绘图。rc.5 实际以 `(async () => {\n${body}\n})()` 语法校验脚本，解析器须采用同一语义并将节点偏移还原到原文。并行与 pipeline 可能指数展开，必须限制总分析工作量而非只限制 agent 数。

运行时 `agent-start` / `agent-end` 包含序号、标签、阶段和子会话，但并不直接包含控制流结构或独一无二的静态调用地址，并发实际触发顺序也未必等同 AST 顺序。无法可靠匹配时必须保留未绑定事件和告警，不得猜测。稳定结构的坐标不能由运行状态或事件到达顺序驱动。

## 004 · 代码审查运行时限制

当前公开的 `workflow` 的 `agent()` 支持按次指定 `provider` 与 `model`，但没有 reasoning-effort 参数；rc.5 `dsh-workflow-ptc/lib/index.js` 的 host `childRequest` 只透传 `prompt/provider/model/schema`。因此请求对象里伪造 `reasoning_effort: 'max'` 既不受支持，也不能证明生效。可并行用独立的 `subagent` 显式请求 `gpt-6.1-sol` 和 `max` 补足；不可把 workflow 默认档位冒称 max，也不暗改全局配置。

## 005 · Workflow 来源、运行状态与持久性

原生 run-start 没有 callId；`tools/result` 可被同名 scoped 工具、around 执行器或结果处理器改写，因此 [来源观察器](../packages/workflow-source-observer/README.md) 只输出 `unverified`，不能构成真实绑定。运行结果的失败和取消可能没有 runId；前台结果返回太晚，后台返回仅表示受理，不是完成。

候选路线需要按实际验收比较，不预先引入完整的新引擎：

- **直接继承现有 engine 的最小 spike**：rc.5 导出的 `PtcWorkflowEngine` 可作为同 scope 单 provider 子类重用执行逻辑，在 `start(request)` 返回后观察入参引用与 runId。真实引擎的[合成反例](../packages/workflow-engine-spike/README.md)已证实，即便前后同一普通属性，依赖也可在中间更改 accepted script 并恢复；额外读取 getter 还可改变行为。观察到的入参不是引擎实际接受来源的证明，更不能推断工具调用、后台 job、拒绝或静态调用点。预先复制/冻结入参会改变原生语义，不能假装透明；需要受控的 accepted-init seam 或更强的明确可信边界。
- **薄 fork workflow 工具**：若需要精确工具/后台 job 以及前台失败和取消链路，可研究在实际执行体记录即将传给引擎的参数和 runId；仍调用原引擎。此工具侧参数亦不自动证明引擎实际 accepted init，around 可改写 exec，关联原始 tool/call 必须额外核对身份和摘要。老记录来源不能猜。[真实 rc.5 `begin` 合成负例](../packages/workflow-accepted-init-spike/README.md)进一步表明，构造时 `init` 与事件、run 共用的 meta 仍可变，甚至两次 begin 可以返回不同 detached 值；不得将最初构造的快照当作 guest 必然消费的数据。

Sol/max 独立分析建议：可信来源至少覆盖三个**不同边界**，优先上游受控 seam，否则再评估版本锁定的小 fork，复用现有执行器而不新造 scheduler：（1）Host 认证原始 session 事件、已解析的实际工具定义及 wrapper dispatch lineage；（2）工具执行分支到 run/job 所有权的交接；（3）engine 真正接收并交给 guest 的不可变 accepted-init 与 run 对应关系。**这些尚未实现，任何一边缺失都不构成来源认证。** around 可以不调用或多次调用 `next`，一次原始调用可能产生 0..N 个 leaf attempt；应由受控 Host 为每个 attempt 分配独立身份，而非假设 call↔run 一一对应。原始参数、wrapper 变换后的有效参数、引擎实际 accepted script/meta 必须分别表示；若不同，只能展示有证据的变换，不能用原始脚本画实际运行拓扑。来源认证、开始受理、运行结局及 durable coverage 相互独立；证据冲突/缺失为 unknown，启用前的历史和在途运行不可仅靠旧 `tool/call` 升级。

如要保证 durable accepted 先于运行受理，现有同步 `start()` 旁边的异步 observer 不够：必须另设计显式 opt-in 的异步 admission/write-ahead 契约，先封存 guest 真正消费的 init、提交可幂等的 accepted/run receipt，再调度/确认；这会改变调用时序，不得冒充透明替换。receipt 已提交但调度前崩溃时执行仍 unknown。若必须保持当前同步 API 及语义，则不能承诺 durable/verified 模式。Session 原始事件是否 durable 又是单独的来源门槛。此方案尚无实现或可安装工件。

无论哪个方案，Host-owned companion store/read-model 必须使用独立版本化 snapshot/watch；原生 Session 投影同步折叠 session 事件，不可在 `wire.view` 偷读会变化的外部 store。同步内存关联不等于持久化：独立 storage 和 Session 日志不具事务，崩溃可能留下 orphan/incomplete；旧记录和缺失终态应保留 unknown。想恢复历史拓扑必须有合法授权的实际来源快照，或可验证的精确事件引用与摘要；保存功能脚本不同于数值遥测，须单独说明隐私边界。

## 006 · 个人遥测的事实与披露边界

当前遥测仅处理 caller 提供的合成内存快照。实施持久库前需区分 observed/provisional cut 与 durable-source cut：`session/event` 可先于异步持久化，冷观察也可能补出内存中断闭合事件。恢复时必须核对来源世代与尾部，事实和 cursor 同事务、purge tombstone 防止回填复活。`sessionQuery` 不提供调用方授权；工具、Remote、面板必须实施自己的范围授权。

官方子会话投影是会话累计，fork 可能继承相同工作；不能将子会话总数或多次快照差值无条件记作单次 invocation 或跨会话总成本。tokenUsage 最终样本可修正早期流式值，asOfSeq 单调不意味着数值单调。缺证据标 unknown/覆盖率，不将统计表中的零当作确定的真实零费用。

不主动发网络请求不等于数据永不离开本机：工具返回值可能进入模型请求，Remote 可跨机。默认本地统计与模型可见查询、Remote、export 是不同披露通道，需明确用户授权和调用方范围；当前原型不开放这些通道。

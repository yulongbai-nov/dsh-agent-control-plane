# 设计决策与范围修正

基线：本机打包版 DSH `0.2.1-rc.5`；不修改签名应用包、核心源码或用户 profile。版本检查与源代码标记只识别明显漂移，不能代替运行时或 GUI 验收。

## 001 · 面板入口不是侧边栏内容

规格 v0.1 将 `sidebar.panellist` 误认为可容纳持续显示的侧边栏内容。rc.5 的 `dsh-client-ui-sidebar/README.zh.md`「全局面板入口」明确：它仅注册图标、标签和 id；同 id 的 `main` keyed slot 才放主区域。真正的侧栏 workspace/session 浏览器是 `sidebar.workspaces` **single** slot，由 `dsh-client-ui-workspace` 填充。单独的主面板能验证树数据与导航，但不满足 R7 的「侧边栏会话树」。

不应通过侵入现有 DOM 或无条件覆盖 single slot 隐藏/破坏原生列表。后续需明确选择可恢复的 slot 组合或小范围 fork `ui-workspace`，并验证搜索、排序、归档和键盘操作。原始规格已记录更正。

## 002 · 单一标题提供方并非可直接替换

rc.5 的 `dsh-session-title/README.zh.md`「提供方」及实现明确：已有 provider 时 `register()` 立即抛错，而不是替换。卸载现有提供方属于配置变更，须征得用户同意；本仓库不会执行。`refresh()` 是显式解除用户固定标题的操作，后台自动更新不得使用；`rename()` 会创建用户固定标题，也不得冒充自动更新。

自动 provider 派发只认合格的人类 `user/message`，还要匹配请求路由。子代理任务或工具事件本身不会触发，因而注册 provider 不能单独满足 R9。不能为了凑效果伪造用户消息；非人类任务触发与合法、可并发且可回放的标题写入路径仍需设计和实测。

## 003 · 确定性工作流结构不能等同于动态实际图

工作流脚本是 JavaScript，静态分析必须保守处理变量、循环、动态调用和 `pipeline` 未知输入；不执行用户脚本来绘图。rc.5 实际以 `(async () => {\n${body}\n})()` 语法校验脚本，解析器须采用同一语义并将节点偏移还原到原文。并行与 pipeline 可能指数展开，必须限制总分析工作量而非只限制 agent 数。

运行时 `agent-start` / `agent-end` 包含序号、标签、阶段和子会话，但并不直接包含控制流结构或独一无二的静态调用地址，并发实际触发顺序也未必等同 AST 顺序。无法可靠匹配时必须保留未绑定事件和告警，不得猜测。稳定结构的坐标不能由运行状态或事件到达顺序驱动。

## 004 · 代码审查运行时限制

当前公开的 `workflow` 的 `agent()` 支持按次指定 `provider` 与 `model`，但没有 reasoning-effort 参数；rc.5 `dsh-workflow-ptc/lib/index.js` 的 host `childRequest` 只透传 `prompt/provider/model/schema`。因此请求对象里伪造 `reasoning_effort: 'max'` 既不受支持，也不能证明生效。要如实进行 Sol/max 审查，需要运行时提供该控制，或用户明确允许变更会影响其他新会话的默认配置。本项目不暗改该配置。

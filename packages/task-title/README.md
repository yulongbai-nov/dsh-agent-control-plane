# 任务标题：rc.5 开发原型，非 R9 交付

**不要安装或启用。** 此包验证 Cordis provider 和保守的团队任务选取；它不能在仅发生任务变化时更新标题，不保留随附的会话摘要能力，也无法保证来源归因准确。它没有 bundle 声明或 patch，不会自动加载，不修改 profile 或关闭已有 provider。

## 能力和边界

- 注册 rc.5 的 `ctx.sessionTitle.register({ id, automatic: 'all-prompts', generate })`，通过 `inject = ['sessionTitle', 'sessions']` 获取服务；只读本地活跃的直接父会话的 `team/task` v2 事件，按 `ownerId` 寻找当前子会话任务。优先最近开始/重新分配的 `in_progress`，无活动任务时保留最后完成任务；后续编辑不会改变任务的开始或完成时间。未拥有、释放、转交或删除的任务不作为候选。无任务、无活跃父会话、未知事件版本或任务修订缺失时抛错，交由标题服务保留原有标题。
- `generate` **只在已由标题服务派发时才执行**，不自行订阅事件，不调用 `rename`、`refresh`、`session.append` 或启动 LLM；因此没有后台循环、网络调用、自动解钉。用户手动固定标题后，rc.5 服务不会自动派发；即使有人显式 `refresh` 且本原型仍是已注册 provider、存在符合条件的消息，本原型也会拒绝 `source.kind === 'user'`。服务负责检查取消与修订、丢弃陈旧结果。
- 这不是完整标题策略：任务事件在 Lead 日志而非 child 日志；只读活跃的直接父会话，父会话不可用则不冷加载；仅处理 team task，不识别普通代理步骤、工具活动或 workflow。不会按真实语义识别“主题变化”；多个活动任务以最近开始为准，可能与真实正在执行的任务不同。
- **来源限制：**rc.5 provider 必须返回至少一个该次请求中、按顺序排列的人类 `user/message` seq，不能使用 `team/task` seq。本原型返回最新的合格消息 seq 以满足接口，但标题实际上取自 Lead 任务事件：`messageSeqs` 只能说明关联的调用上下文，**不能证明此消息是任务标题的来源**。没有合格消息就不能写入标题；不应作为可靠溯源功能使用。
- rc.5 服务不会在 `team/task`、工具调用或任务结束时派发：只有 `source.kind === 'user'` 的非空文本消息会安排工作，且需后续 `request/header` 或匹配 route 的主 agent-loop 请求才开始。一次任务变化可能永远没有新消息，所以本原型**不能保证 R9 的一回合时限**，闲时保留亦仅在下次派发时取值。没有严格时限；失败时自动路径会记录警告，并非完全静默。
- 自动路径的并发和手动钉住保护依赖 rc.5 标题服务而不是此包自行写事件。不要自行追加 `session/title`，也不要在任务监听器中调用 `refresh()`：`refresh` 是**显式解钉**操作。特别是没有 provider（或 provider 已 closing）且存在首条合格消息时，它会追加 fallback 并覆盖用户标题；本原型的拒绝只适用于已注册、服务实际调用到本原型的分支，并非所有 `refresh`。

## 与既有 provider 的冲突

rc.5 一次只接受一个 provider；已有 provider 未开始释放时，第二次 `register` **立即抛错，不是替换或链式组合**。默认 base 的 id 是 `session-title-llm`（first-prompt）；随附 experimental bundle 会禁用它并插入 `optional-session-title-all-prompts`。实际 profile 可能不同，必须检查当前加载状态，不能根据这两行假定唯一配置。

如果以后人为卸载/禁用现有 provider 再装上此原型，则所有会话共用的旧标题策略、模型摘要、自动更新行为会丢失；本原型在根会话及无任务的子会话会失败、仅保留已有标题或内建首消息 fallback。不能从公开注册表取回或代理已登记 provider，也不存在安全的无损替换。卸载期间/失败后要显式恢复旧配置。开发原型**不包含**禁用旧项的 patch，不提供生产安装步骤。

## 构建、测试与未来集成

此包是原生 ESM 源码，无 TypeScript 转译、打包或运行时依赖；Node 24 下无需安装：

```sh
cd packages/task-title
node --check index.js
node --test test/task-title.test.js
```

可选：下列本机 macOS Electron 命令从已安装的 `0.2.1-rc.5` `app.asar` **只读加载真实** Cordis、会话存储、投影及标题服务，用内存测试注入、派发、冲突、手动钉住、取消/陈旧结果和无 provider 的 `refresh` 解钉；不访问当前运行中的桌面 profile，不发送 LLM 请求：

```sh
ELECTRON_RUN_AS_NODE=1 \
  '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  --test test/rc5.integration.js
```

该命令依赖本机 app 的路径、版本和 Electron ASAR 读取能力；在其他平台/路径不可直接运行。普通 `node --test test/*.test.js` 不包含它，避免把不存在的 Electron 引入普通测试。

未来需另行实现和实测以下 seam 后才讨论安装：标题服务提供**非解钉、可取消、会话存活及修订受保护的任务事件触发机制**；明确跨会话任务事件的真实来源/provenance；保留或显式重构原摘要能力；处理冷恢复、无合格消息、可用性和错误语义。届时应遵循 rc.5 包的 Cordis 入口惯例，将 provider 放入正式 bundle 和经审查的 profile 组合中；须先取得用户授权，再验证互斥 provider 的卸载/失败回退及已启动 Web 应用实际效果。**本次未安装、未构建 Web、未验证 GUI。**

## rc.5 证据（安装包内的代码路径）

以下为只读检查的 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/` 中的路径和行号；`rc5.integration.js` 对其中核心行为做内存验证，不能代替完整真实会话/GUI 验收。

| 证据 | 结论 |
|---|---|
| `dsh-session-title/lib/index.js:251–274,380–445` | 只监听合格 `user/message` + 路由就绪/loop；任务事件不触发。 |
| `dsh-session-title/lib/index.js:295–349,358–378` | `rename` 固定，`refresh` 的 fallback 分支可解钉；单 provider、冲突抛错、dispose 才释放。 |
| `dsh-session-title/lib/index.js:452–518,520–550` | provider 接收 `session/messages/currentTitle/signal`；输出至少一个有效消息 seq；修订/abort 校验，陈旧结果不提交。 |
| `dsh-session-title/README.zh.md:30–32,55–65,89–95,136–139` | 自动失败保留标题；标题存日志；服务管理生命周期；无 provider 组合接口。 |
| `dsh-experimental-agent-team/lib/index.js:140–159,267–268,457–470,608–614,824–835,1217–1240,1272–1294,1338–1354,1370–1379` | journal 将 v2 `team/task` 追加到 Lead 日志；teamId 即 Lead session ID；创建为 revision 1、pending 且无 owner，随后修订连续；claim 使用 caller session ID，reassign 将成员名解析为 member session ID，字段名是 `ownerId`。 |
| `dsh-session/lib/index.js:1480–1515,1816–1829` | event append 同步通知、`header.parentSession` 来源；本原型只取即时快照。 |
| `dsh-base/cordis.patch.yml:60–77`；`dsh-experimental-session-titles-bundle/cordis.patch.yml:1–12` | 默认及实验 provider 的 id 和覆盖关系；并不证明当前 profile 的实时配置。 |
| `dsh-session-title-all-prompts-llm/lib/index.js:103–125`；其 `README.zh.md:30–42` | 原 provider 对合格消息独立 LLM 摘要；替换它并不保留原行为。 |

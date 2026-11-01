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

另一组只读加载真实 rc.5 的内存 seam 探针：

```sh
ELECTRON_RUN_AS_NODE=1 \
  '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  --test test/seams.rc5.integration.js
```

两组命令依赖本机 app 的路径、版本和 Electron ASAR 读取能力；在其他平台/路径不可直接运行。普通 `node --test test/*.test.js` 不包含它们，避免把不存在的 Electron 引入普通测试。新增探针只用合成内存会话，无持久化、用户会话、网络或模型；其人为构造的 `user/message` 用于测试 rc.5 合格消息路径，不是自动更新伪造消息的方案。

## R9 合法接缝调查（rc.5）

**没有找到能同时满足 R9 触发、有效来源、pin 与并发、冷恢复的公开标题服务接缝；不要安装或启用本原型。** `ctx.sessionTitle.get/rename/refresh/register` 之外未发现自动任务提交 API；不要凭 JavaScript 运行时可见的内部方法/字段调用私有 `supersede`、`runProvider` 等，也不要重命名用户标题、伪造消息或直接追加 `session/title`。已注册 provider 的对话摘要能力仍应保留；本次没有替换它。

真实 rc.5 内存负例（`test/seams.rc5.integration.js`）：

1. Lead 的 `team/task` 创建/claim 后，即使 child 出现 `request/header`，无合格人类消息时 provider 不执行、标题不追加；`refresh()` 也不能驱动生成。provider 的 `messageSeqs` 只能是本次请求的 child 合格消息 seq，错误引用 task seq 被拒绝；跨会话 team event 更不在其序号空间内。
2. 任务变化不会使正执行的 provider signal abort 或增加标题修订；合成测试中旧任务的在途结果随后可以写入。这是 title service 没有订阅或标记 task 依赖的实证，不代表 rc.5 对**新用户消息**的取消逻辑有问题。
3. 人工 `session.append('session/title', ...)` 即使写 `source.kind='user'` 也不会通知标题服务 `supersede()`；在途 provider 可覆盖它。`session.append` 是 Session 的低层可调用能力，不是 title service 对 pin/CAS/来源的接受接口；服务监听事件时同一 session 的重入 append 亦被拒绝。
4. 对 pinned 会话有合格消息且存在普通 provider 时，`refresh()` 可提交 provider 结果并解钉；无 provider 分支也可追加 fallback 解钉。既存本包 provider 因自查 user source 而拒绝，只是该 provider 的行为，不能推广给 rc.5。后台调用 refresh 的“先 get 后检查 pin”还无法在跨 await 调用链里对所有并发和 provider 卸载保证原子性。
5. 将合成事件快照交给 `SessionStore.prepare(..., eventState:'shared-frozen')` 重建并 attach，冷期间 Lead 任务变更不会自动更新 child 标题；旧值一直保留到新的合格消息；已 pin 则仍保留。该测试只证明真实 rc.5 Session 恢复/attach 路径，**不证明磁盘持久化、跨进程单写或完整 agent coldResume**。`sessionQuery.readSession` 的冷读取返回脱离存储的结果且不激活/写回，不能作为冷会话写入 API。

### 最小可行上游／外置 fork 方向（设计，未实现）

1. **服务内单一接受者：**在 `dsh-session-title` 内新增受控的 task-change 自动请求/提交 seam，而不是第二个 writer。调用方须证明授权和来源；输入包含 child session ID、Lead session ID、team/task 事件的确切 seq、task ID/revision、任务状态/owner 和所需的稳定任务主题（不可仅凭用户文本或标题猜测）。多个活动任务的优先级、任务结束后的最后标题，以及无任务/删除/重分配应在产品层明确。
2. **复用 service 原子门禁：**自动请求与用户 `rename()`、官方 provider 和同会话任务更新统一进入 session-local revision/AbortController 调度；在执行/提交前验证同一 exact live Session、调用方授权、事件来源与最新任务 revision、尚未 pin、服务/信号未取消。`pin` 检查、修订/来源校验与追加须在同一同步提交边界完成，不跨 `await`；任务变化必须 supersede 旧工作，旧任务及旧会话身份的迟到结果不得覆盖。Lead 和 child 是独立日志，此门禁仅覆盖进程内已观察到的状态；跨日志/跨进程提交仍需第 4 点的协调或明确最终一致保证。失败保留现有标题并限制错误/日志泄漏。
3. **合法来源和持久化：**新增类型化的 `task` 来源（带 Lead session ID 和 event seq，或有约束的引用），而不是假填 `messageSeqs`；明确事件 schema/版本、兼容迁移、跨会话因果关系与 title projection。先确认支持的旧 reader 和未知 source 策略，再设计回滚或明确最低版本；不能仅直接写新枚举值期待 rc.5 安全回放。
4. **冷会话不丢更新：**由受控 durable 协调层记录/折叠 Lead 任务 revision 和待对账目标，child 恢复时在持有唯一写权限并恢复 pin 状态后重新检查最新可用任务；或扩展持久服务提供原子且受 pin 保护的单写事务。明确跨日志次序、已归档/删除/权限、崩溃重试、幂等及可用性，不能让只读 query 冒充写句柄，不能无授权唤醒用户会话。
5. **provider 共存：**保持现有 provider 的消息摘要与错误行为；若要“任务优先、闲时摘要”，在同一标题服务内部明确仲裁、来源和切换，或由协调者显式拥有并组合两个生成器；rc.5 单例注册表不能无损取得已注册实例来自动包装。设计兼容/用户授权后用独立合成环境测试任务/消息重叠、pin 与解除固定、provider 卸载、失败/取消、跨会话并发、重放/恢复、持久 flush 和旧读者。

上述是需实际 fork/上游扩展后才可审查的最小方向，不是当前可用 API 或安全实现；跨会话原子性、source schema 与权限模型尚待明确。**本次未安装、未构建 Web、未验证 GUI。**

## rc.5 证据（安装包内的代码路径）

以下为只读检查的 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/` 中的路径和行号；`rc5.integration.js` 对其中核心行为做内存验证，不能代替完整真实会话/GUI 验收。

| 证据 | 结论 |
|---|---|
| `dsh-session-title/lib/index.js:251–274,380–445` | 只监听合格 `user/message` + 路由就绪/loop；任务事件不触发。 |
| `dsh-session-title/lib/index.js:295–349,358–378` | `rename` 固定，`refresh` 的 fallback 分支可解钉；单 provider、冲突抛错、dispose 才释放。 |
| `dsh-session-title/lib/index.js:452–518,520–550` | provider 接收 `session/messages/currentTitle/signal`；输出至少一个有效消息 seq；修订/abort 校验，陈旧结果不提交。 |
| `dsh-session-title/README.zh.md:30–32,55–65,89–95,136–139` | 自动失败保留标题；标题存日志；服务管理生命周期；无 provider 组合接口。 |
| `dsh-experimental-agent-team/lib/index.js:140–159,267–268,457–470,608–614,824–835,1217–1240,1272–1294,1338–1354,1370–1379` | journal 将 v2 `team/task` 追加到 Lead 日志；teamId 即 Lead session ID；创建为 revision 1、pending 且无 owner，随后修订连续；claim 使用 caller session ID，reassign 将成员名解析为 member session ID，字段名是 `ownerId`。 |
| `dsh-session/lib/index.js:1368–1428,1480–1537,1563–1570,1816–1829` | 内存 restore / `session/end-seed`、event append 同步通知及同会话重入拒绝、`header.parentSession`；本原型只取即时快照。 |
| `dsh-session-query/README.zh.md:32–45,106–110`；`dsh-session-persistence/README.zh.md:34–57` | 冷 query 是只读脱离存储的观察；持久写需要专属句柄与 flush，不是 `readSession` 的副作用。 |
| `dsh-session-format-v3-to-v4/lib/index.js:837–843` | v3→v4 迁移时要求非 user 标题引用同一日志中的 human message；新 task 来源的兼容性必须设计，不能假填跨会话 seq。 |
| `dsh-base/cordis.patch.yml:60–77`；`dsh-experimental-session-titles-bundle/cordis.patch.yml:1–12` | 默认及实验 provider 的 id 和覆盖关系；并不证明当前 profile 的实时配置。 |
| `dsh-session-title-all-prompts-llm/lib/index.js:103–125`；其 `README.zh.md:30–42` | 原 provider 对合格消息独立 LLM 摘要；替换它并不保留原行为。 |

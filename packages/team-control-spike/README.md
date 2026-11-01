# 动态团队接缝研究（不安装）

**这不是 Team 插件、权限服务或 native 归档门禁。** 目录保留一组先前使用声称的 rc.5 官方 `TeamService` 与纯内存依赖进行的历史测试，以及一个**未接 DSH** 的单 owner 排序模型。历史 native 夹具现已禁用，不能从当前目录重跑或验证实际安装版本；这里没有生产兼容承诺。无用户数据/会话，不能完成动态团队、模型选择、归档或唤醒需求。不配置、不安装、不启动 GUI/服务、不发送模型请求。

## 先前记录的 rc.5 来源研究与候选边界（当前未重验）

以下是先前对安装版源码/有限 fixture 的研究记录及候选设计，不是当前可重复或已认证的版本事实；当时 native 测试缺少导入前 pin，具体限制见下节。后续落地必须在获准隔离环境重新确定基线、来源、权限与行为。

- 按当时研究，每个普通 root 是隐式 Team Lead，Team id 即 root Session id；无需另造 create Team 服务。`ctx.agentTeams.spawnTeammate(exactLead, request)` 在 Lead session 写并 flush provisioning（单 team journal 排队，限制同名和名额），`ctx.subagents.startActivation` 负责真实子 Agent，checkpoint 初始消息后写 active；失败写 failed，名字不复用，恢复重查 child Session。`sendMessage` 使用 exact live caller 的 membership，返回 inbox 接收 id，不是已执行/已落盘保证；cold continuation 由 subagent owner 维护，同 Session 恢复。task board 有 CAS。均应复用而非另造成员、收件箱或 Session。
- `spawn_teammate` 工具参数没有 `agentOptions`/`agentPreset`；即使直接把字段传给 `spawnTeammate`，rc.5 `TeamRoster.spawnAdmitted` 创建 activation 时只传 `prompt` 和 `parent`，覆盖字段会被丢弃。要支持成员模型/preset，候选是**经版本锁定和授权的小 fork/上游扩展**，在工具和 Host API 显式校验请求，并在原有 activation `request` 内透传允许的 `agentOptions`、`agentPreset`；不要绕过原 team journal/initial checkpoint/parent authority。`spawn` provider 支持独立 preset，`fork` 不支持，会被底层 capability 拒绝；不能对缺功能的 provider 静默降级。preset 的冷恢复按当前注册 revision 而非锁定原 revision，因此还不能承诺身份/工具完全冻结。真实权限、provider 注册和模型可用性必须另测。
- workspace 原生 `archiveSession` 可持久隐藏指定 session；非强制归档对活动工作拒绝，强制归档先写 archived 再请求停止。session-controller `agent/pre-step` 会拒绝 archived session/子孙的模型 step，**不保证 send 本身拒绝**：team/subagent 可能先收消息再 blocked；原生 `sendMessage` 本身不检查 archive。因此不满足“归档期间拒绝所有消息”。
- 未来需在**共享且可信的 admission owner** 序列化 archive/unarchive 与所有 send/queue/steer/coldResume 入口，并结合 workspace archive 写入和已有 session gate；仅包裹 `sendMessage` 或对 archive 做先读后写有竞态，而且无法阻止绕过路径或第二进程。必须同时定义任务所有权、已有 accepted inbox、正在运行任务和强制 stop 收敛，授权由 Host 校验 workspace/成员与用途。先持久 unarchive 再允许原生冷恢复同一 Session；未证实不能宣称已实现。全局 session archive 还有 UI/工作区副作用，不可私下调用。

## 验证 1：历史 native 组件观察（当前不可重跑）

此前的研究记录称：`test/rc5.baseline.cjs` 曾读取当时安装版中的 Cordis 和 `TeamService`，并用内存 fixture 代替 agents/sessions/subagents/projection。按当时报告，合成调用观察到 provisioning→flush→startActivation→active→flush、服务丢弃 `agentOptions`/`agentPreset`；provider 或 checkpoint stub 失败时记录 failed 并 drain 子成员、失败名不复用；冒用 live Agent 和 teammate spawn 分别被拒绝。**这是条件性历史报告，不是当前重新验证或受 pin 保护的证据。** 当时 fixture 没有在 import 前独立验证完整 native 源版本/hash；以前标为 rc.5 仅是当时的版本上下文，不能断言这次运行实际加载了哪份内容，也不能推广到变更后的安装。`checkpointInitialPrompt` 是合成 stub，没有证明初始消息持久化、真实 Session/projection、后台生命周期、部署、恢复、请求认证或 GUI 效果。

现在四个历史 native case 在执行前明确 `SKIP NATIVE_BASELINE_UNVERIFIED`，`fixture()` 使用固定拒绝锁，既没有安装模块加载器，也没有通过环境变量或调用者提供的版本/hash/boolean 启用路径。此举是**禁止未经验证的 native 导入**，并不是实现 native 版本验证或保证当前 native 行为。普通 `node --test` 显示四条 skipped、0 passed；不是四项通过。对应的离线测试只验证固定拒绝、历史 case 均跳过，以及伪造的 caller 声明不能触发加载；没有读取任何安装包。要恢复 native 测试，必须在适用权限下先独立确定版本与**所有实际依赖**的可信基线，另设计加载前验证、TOCTOU、许可和隔离策略，再经单独审查与授权。不能使用其他包的 hash 冒充 TeamService/Cordis 的 pin。

## 验证 2：单 owner 参考模型

`gate.cjs` 是仅供 TDD 的纯内存模型：先从 `uncertain` 开始，`reconcile` 需要假 adapter 返回 authoritative boolean 才开放；一个队列串行 `send`、`archive`、`wake`，以明确地测试双方先后顺序。持久写失败进入 uncertain，阻止 send/状态更改并要求对账，**不假设失败=没写或自动回滚**。send 报错直接透传且不自动重发，接收结果可能未知。测试中的 adapter 与 Session/Team 完全无关，不具事务、授权、进程锁、强制停止、真实持久性或跨入口覆盖。模型假设所有操作都通过它；只需要一个绕行入口，或另一个 owner/进程，就不提供保障。不可安装、接入真实数据或将测试结果宣传为 native 安全保证。

```sh
node --test packages/team-control-spike/test/gate.test.cjs packages/team-control-spike/test/baseline-safety.test.cjs
```

两组均为普通 Node 合成测试；后者只启动独立 Node 子进程执行固定拒绝和显式 skip，不启动 DSH、本地服务或浏览器。

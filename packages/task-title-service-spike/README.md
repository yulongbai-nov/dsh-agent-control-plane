# 任务标题服务调度：合成内存研究（不可安装）

**状态：仅无落日志的合成调度模型；不是 DSH 服务 fork，不注册 provider，不写 `session/title`，不满足 R9，也没有授权用于真实数据。** 不安装、不进 profile、不接 GUI 或真实会话；只有明确的后续受审实现才可继续。当前无用户消息伪造、外部观察器代写、模型请求或持久化。`package.json` 为 private，仅研究测试。模型中的 `host.title()` 返回进程内的合成状态，不是 rc.5 投影、事件或可回放成果。

## 已确认的 rc.5 事实与许可

- 本机打包 `@deepseek-ai/dsh-session-title` 为 `0.2.1-rc.5`，桌面构建 metadata `dshBuildCommit=d4db512a969fccf0c5cc7ec8fe38e9c1d27af916`，`dshBuildDirty=false`；归档内 `dsh/node_modules/@deepseek-ai/dsh-session-title/lib/index.js` 约 651 行，SHA-256 `eb814490ca3d0aaabf8f6ddc705a031f99a98709c484c1502c5f28f101cf0eeb`。安装包中的许可为 MIT，`Copyright (c) 2026 DeepSeek`，允许在保留完整版权与许可的条件下复制修改；本研究**未复制其代码**。若未来 fork，上游 license 必须随分发，并确认目标版本与安全条件。
- 服务 `lib/index.js:251–274,380–445` 仅观察合格人类 `user/message` 与 route/header，`team/task` 不派发标题；`295–349,358–378` 中 `rename()` 同步超越/abort 旧工作并写 user pin，`refresh()` 是显式解除固定，provider 只能单个注册。`452–550` 在 provider 等待完成后检查存活、signal、准确 Session、revision 和 registration，再接受由同一 Session 人类消息 seq 构成的结果。`603–647` 的 fallback 也是服务逻辑。已有模型摘要不能靠注册第二 provider 无损组合。
- `team/task` v2 任务日志属于 Lead Session，`ownerId` 是成员 SessionId；Lead 和 child 是不同日志。`dsh-session/lib/index.js:1514–1537,1563–1595` 在 session 事件发布期间拒绝**同一 Session**重入 append，观察投递不是跨日志事务。`ctx.sessionQuery.readSession` 只读取且不会使冷会话活跃或获得写句柄；必须在授权和唯一写者边界内处理重建。
- `copySessionTitleSource`（`dsh-session-title/lib/index.js:99–111`）只接受 `fallback/provider/user` 三类；未知 kind 落入 `assertNever`。`dsh-session-format-v3-to-v4/lib/index.js:837–843` 验证非 user 标题必须引用同一日志较早的真实 human `user/message`，并要求 user title 的消息引用为空。**不能把 Lead task seq 假填到 child 的 `messageSeqs`、伪造用户消息或新 kind 并声称旧 reader 兼容。** 完整实现需联合设计事件版本、schema、旧读者拒载/迁移及回退后果。
- [既有 rc.5 实服务负例](../task-title/README.md#r9-合法接缝调查rc5) 已在隔离内存中发现：任务更新不取消在途 provider，原始 append 的伪 user pin 可被在途结果覆盖；后台 `refresh()` 可解钉；冷会话恢复时任务更新不会自动追补。那些测试并非真实用户/磁盘/GUI 验收。

## 合成模型及其假设

`createSyntheticHost()` 私有持有 token、任务最新状态、存活 child、标题和理想化权限；`createModel()` 是唯一模拟服务 owner。手动 `observe(lead, cut)` 对已附着 child 验证授权、完整性和 cut；有效观察中该 child 的唯一候选任务对象/修订改变或上次对应尝试可重试时才递增共享 revision、abort 旧信号并合并微任务；不完整观察只使旧的任务工作失效，不无故取消消息工作。任务生成前及生成后依次复核：

1. 服务活跃、精确 lead/child 对象仍存活且父子关系相同；`authorized===true`，授权 epoch 未改变；
2. 合成任务序列完整、仅选恰好一个该 child 的 `in_progress` 任务；`cut` 等于 host 当前高水位；生成期间高水位、task 对象、revision、owner 和状态未变化；
3. 当前标题不是 user pin，signal/revision 仍有效，生成文本有效；**最终这些合成内存检查与 `title` 属性赋值之间无 await 或第三方回调**。

任务快照的“已观察”不等于“已提交”：独立记录生成尝试 `pending / committed / invalidated`。同一候选 pending 或 committed 时合并重复观察；高水位过期、旧 cut、授权 epoch 变化或 generator 失败使 pending 失效后，只有**下一次显式完整 observe** 才可重试，不在 catch、finally 或 idle 内自动重试；如该次观察已知 pending 所用 cut/epoch 过期，可先取消它再尝试。新消息、用户 pin 或主动 invalidate 会阻断同任务版本的重试。每次合成 `message` 同步记下该合成 Lead 的高水位为 message fence：同一旧候选即使在其他任务变化、歧义消失或首次迟到观察后也不能覆盖消息；仅当候选任务自身的 seq 晚于 fence 才可能仲裁。这个跨对象高水位是合成 host 的理想同步假设，不证明真实跨 Session 的因果顺序。`rename()` 和合成 `message()` 共用 revision/abort，模拟消息工作与任务工作互斥，避免旧结果覆盖新结果。`message()` 并不实现原服务的 provider 注册、人工消息 schema、route 或模型。`dispose()` 取消并等待生成器 quiesce 后释放模型 owner；生成器不合作会使 dispose 等待，这只是保守模型，与官方 provider 可开始 closing 后允许替换的精细生命周期**不等同**。候选策略只识别唯一 in-progress，多个活动任务、pending、完成、删除均不生成，不实现产品中“最近任务/完成后保留”的最终语义；任务移交/释放后沿用已有合成标题，不声称该标题仍是当前来源。遇到非法修订、重放或缺口后合成 Lead 的完整性永久标 false，保留先前显示值但不再声称是可信当前任务，除非另行构建经验证的恢复机制（尚无）。

**“准确高水位、可直接比较最新任务及活跃身份”仅是合成 host 的理想化事实，不是当前 rc.5 已证明的读取/鉴权 seam。** `authorized` 布尔和 epoch 只能测试模型条件，不代表真实调用方、scope、跨会话权限或授权撤销机制。对过期 cut、断续修订、未知权限、来源不明确、冷会话和多任务歧义按模型不写；真实系统无法证明没有 unseen task 时，也必须 fail closed / unknown。模型不会自动接收真正事件；在冷会话 reattach 时不会重放冷期间变化，需调用者重新观察，且这不证明 durable 恢复。

单进程 JS 的同步检查仅约束这个 synthetic host 中的同步更改；不证明两个 Session 日志之间原子、跨进程单写、持久化顺序、flush、crash 后重建、授权变更信号、实际服务事件监听完整性或 `≤1 回合`。也不证明 hostile getter/巨大对象下资源安全：合成 task 接口拒绝 accessor/Proxy/额外字段，但 `Reflect.ownKeys` 仍可能一次分配大量 key。不要暴露为生产工具或将此模型结果转换成真实 title 事件。

## 本地测试

在此目录 `npm test`；仅 Node 内建 `node:test`，合成 token/对象、fake 生成器与人工放行，不访问安装版、真实数据、profile、服务、网络或 GUI。测试覆盖任务触发而无消息、手动 pin、task/message 互相 supersede、迟到结果、revision 合并、完整性失败、owner 转移/释放/删除、多任务歧义、权限 epoch、exact session dispose/recreate、冷更改未自动重放和服务关闭 drain。

## 后续前置（均未实现）

需先制定并审查唯一服务内部、可授权且会及时观察的真实任务接缝；为新 task 来源制定版本化事件 schema/兼容迁移、pin 与服务 revision 原子接受、现有 provider 仲裁和 session identity/lifecycle 验证。还需说明跨日志最终一致边界、durable watermark、冷会话授权对账、崩溃/重启/单写/flush 和缺失状态语义，**在这些证据具备之前不能向原生日志追加新事件**。然后才能在不涉及用户数据的隔离合成环境尝试最小 fork，与真实 rc.5 服务对照原行为和新版本 reader 的拒载/迁移，之后才讨论是否授权部署。

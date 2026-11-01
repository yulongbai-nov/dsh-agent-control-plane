# Workflow companion 单 owner 内存原型

**不是持久存储、插件、权限服务、source 认证或可恢复实现。** 只建一个用合成事件驱动、无正文、每 run 独立 revision 和定向通知的进程内原型，以便验证未来 Host sidecar 的边界。进程退出即全部丢失，不读写 session、profile、磁盘、GUI 或网络；不得用于声称某 run 的来源/持久性已验证，也不与 projection 的 verified 输入相连。

```js
const {createMemoryRecords} = require('./index.cjs')
const records = createMemoryRecords() // 所有输入均须由受信 Host 先授权并规范化
const key = {sessionId:'synthetic-session', runId:'synthetic-run'}
const unsubscribe = records.subscribe(key, ({revision}) => { /* 通知后 read(key) */ })
const before = records.read(key) // {state:'unknown'}，不是权威的“不存在”
records.observe(key, {type:'run-start', eventSeq:2})
const current = records.observe(key, {type:'run-end', eventSeq:4, outcome:'completed'})
unsubscribe()
```

`eventSeq` 是受信调用方提供的 source session **事件记录**序列，不是 workflow `agent-start` payload 中的 agent 启动序号，也不是工具 callId；不提供确认落盘、代际、workspace 及来源签名。需要 host 负责同 session+run 归属和单调顺序。本接口不是原生事件：原生类型 `tool-workflow/run-end` 的 `data.stopReason` 要由尚未实现的可信 adapter 核验 session/run/seq 后规范化成此处 `run-end.outcome`，不接受直接传原生 payload。rc.5 PTC 原生 stopReason 枚举为 `completed`/`error`/`cancelled`；其中原始 `error` 保留为 `observedOutcome:'error'`，仅显示用 `lifecycle:'failed'`，不会丢弃原始原因类别。其他原生事件不输入本最小版本；输入类型之外字段一律拒绝。相同事件重放幂等，同序号不同事件 `CONFLICT`，新增事件倒序 `OUT_OF_ORDER`，异常不改变快照/revision。开始先于结束，最后可见 observed lifecycle 为 completed/failed/cancelled；这只是传入观察，不等于 session 已落盘、全部子事件完整或 source 被绑定。无 start 却见到 end 的孤儿 `{state:'incomplete',lifecycle:'unknown'}`，重启后的 reconciliation 由尚未实现的 host 负责，不能据此推断已完成。

有记录时，`read` 和 `observe` 返回冻结的 `{version:1,state,revision,sessionId,runId,sourceStatus:'unverified',hasStart,startEventSeq,lastEventSeq,observedOutcome,lifecycle}`：事件引用是来源记录 seq；`startEventSeq:null` 表示未知；`observedOutcome` 是传入的 end 声称（没有 end 时为 null），不代表真实终态或已落盘。revision 只属于这个进程内的这个 run，按实际变化增一，不能跨重启比较；无记录返回 `{state:'unknown'}`。记录仅保存这些原始值及用来检测重放冲突的 start/end 白名单事件，不接受脚本、prompt、参数、名称、标签、模型、`sourceBinding`/`verified` 等字段。尽管不保存正文，session/run ID 与事件序号仍是敏感元数据，调用方应限制展示与披露。`sourceStatus:'unverified'` 始终与 lifecycle 分离，不能升级为 verified。

`subscribe(key, listener)` 精确过滤两个键，watch 只在状态原子提交之后按 revision 顺序同步通知 `{sessionId,runId,revision}`，快照/通知均冻结；异常及异步 rejection 被消费，取消可重复调用。同步通知期间任何 `observe` 均抛出 `REENTRANT`（包括不同 run），以防一个监听器自触发递归扰乱顺序；监听器应排队后处理，并自行处理被拒绝的写入。异步回调/其它闭包仍能耗时、访问全局或稍后重入，本组件不提供沙箱、隔离或背压。订阅后读取一次 revision，丢通知/重连时重读；不存在跨进程保证。每份订阅各自取消，运行中已取消的订阅不会再收到当前通知。

函数输入只接受无代理、无 accessor 的 plain/null-prototype 记录及有限原始标量；键和序号会一次验证并复制，避免 getter/proxy 和可变引用。`maxRuns` 上限 1,024、`maxListeners` 32（可以下调），ID 最长 256 UTF-16 code units；到达上限显式 `LIMIT`。限额不能替代 caller 授权或过程隔离。`read(key)` 和 `subscribe(key, ...)` **不检查用户、工作区或会话授权**：只供已授权同进程 host 内部使用，不可直接暴露工具、Remote 或客户端。

## 后续持久化设计要求（未实现）

- rc.5 `storageDomain` 每域单进程串行写入：backend 成功才变更内存并依序发 `domain/changed`，`update(key, fn)` 在同队列对现存记录做更新。源码 `KvTableImpl.put/update` 并未执行 schema parse（尽管 README 有笼统的 schema-validated 描述）；只在 domain open 加载记录时解析，故 adapter **须在持久化前自行校验**。其不是跨 session 日志事务、跨进程 CAS 或外部变更订阅；`put` 没有原生 create-if-absent，必须由单 owner 串行管理。Domain 的单键读取当前返回值引用；未来实现需复制/冻结、限制无关组件直接操作 handle。
- 可考虑每 session/run 对应一个可安全编码的 storage key、单条 schema-versioned 完整快照（含 start/end 证据、revision 与独立 source/coverage 信息），同一记录内完成受控 revision 检查和写入；一旦后端失败，不得发布成功的内存版本或 watch。backend 错误也不能一概解释为磁盘绝无变更：JSON 文件可能已 rename，之后的目录 fsync 才失败；应冻结后端并按 uncertain 重新打开/核对，避免盲重试/覆盖。非事务宿主序列化不是跨进程锁。schema 变更、键哈希冲突、防重放/删除、升级和 shutdown 的行为须在 adapter 专门设计并测试。
- storage JSON **per-record** backend 的非法文件/无法解码/不接受的版本可被跳过，域 schema 配置亦可能 backup-and-skip；因此缺记录不等于从未存在。`single` whole-unit 版本不匹配则在打开时明确拒绝，不应混淆两种布局。持久侧存和 session event 的先后均可能崩溃或失败：sidecar-only、source-only、缺头/尾、写入失败均保持 orphan/incomplete/unknown；恢复不能按名称或时间猜关联。只有经授权的精确来源事实及可验证 durable generation/tail/cursor 才能做对账；持久 companion 与原始 session cut 不构成跨库原子快照。session 实时事件可能先于异步持久化。
- watch/snapshot 必须有独立可认证的 host 接口和版本，不能在同步 `wire.view` 偷读外部 store；对每次 read/watch 的 workspace/session 范围以及本地视图、工具、Remote、模型和 export 的不同披露通道分别授权。回调只能当 invalidation，reconnect 需重读。脚本文本/实际 source 要求单独明确授权、保留期与删除策略；本原型无法恢复拓扑和重跑。

## 测试

```sh
node --test packages/workflow-records-memory/test/*.test.cjs
```

测试完全基于合成输入，不安装依赖，不接真实事件或持久层。

# R18 个人统计：内存数据层原型

**不是可安装插件，也不是持久化数据库。** 只创建 Node 24 `node:sqlite` 的 `:memory:` 数据库，不读真实会话、不访问 profile、不出网。只接受调用方提供的合成投影快照，无历史扫描、宿主监听、导出、清除或真实数据写入。关闭进程/数据库后数据消失；不能宣称已完成 R18 的 SQLite 文件存储、回填、持久化或报表。

## 输入与权威口径

`createMemoryStore()` 返回 `ingest(request, {signal?})`、`ingestBatch(requests, {signal?})`、`get(sessionKey)`、`close()`。无需配置文件或依赖安装。示例仅使用合成值：

```js
import { createMemoryStore } from './index.mjs'
const store = createMemoryStore()
try {
  store.ingest({
    sessionKey: 'a'.repeat(64), sourceIdentity: 'b'.repeat(64),
    snapshot: { kind: 'sequenced', asOfSeq: 12, values: {
      tokenUsage: { uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 0 },
      sessionStats: { turns: 1, steps: 1, llmMs: 2, toolMs: 0, ttftMs: 1, ttftSteps: 1, decodeMs: 1, decodeTokens: 2 },
    } },
  })
  const row = store.get('a'.repeat(64))
} finally { store.close() }
```

字段只白名单读取 rc.5 `tokenUsage` wire view 的四个 provider token 桶及 `sessionStats` wire view 的八个数字；不会把 prompt、回复、工具参数、标题、路径、模型或额外字段保存到数据库。`tokenUsage` 内部折叠 state 虽有 `totals`，公开 `wire.view` 本身是这四个字段，不能把存储 cache 结构误作 wire 数据。本层不估 token、不假装已把指标精确关联到某个 workflow 或 agent。输入须为真实已验证的 `kind:'sequenced'` 投影及其 `asOfSeq`；`migration-required`、cache hint、缺 seq、负数/非数值/精度不安全均拒绝。单位缺失为 `null`，不是 0；单个 unit 不完整则拒绝整个输入。

`sessionKey`、`sourceIdentity` 接受 64 位小写 hex。**形状不等于隐私保证**：真实 adapter 要在用户同意后负责稳定的身份映射与适当的带秘密密钥 HMAC、密钥管理、源世代/日志生命周期校验；不建议把低熵身份直接 hash 后当作脱敏。source 身份变化时本层拒绝，不能跨重建世代误合并；安全重建/替换身份的授权流程尚未实现。

## 幂等与原子性

以 sessionKey 为主键，sourceIdentity 必须一致；更高 asOfSeq 替换该会话的最新数值，同一 seq 的相同 unit 不动、缺失 unit 可补齐、不同数值冲突则拒绝，旧 seq 不能回退。高 seq 若缺 unit 则返回 `null`，不沿用旧快照。批处理在 SQLite 本地事务中全成或全回滚，包括同 seq 冲突；abort 只在本次同步事务之前/期间边界检查并回滚，不声称可中断正在执行的同步 SQLite 调用。

快照 cursor 只描述**该次读取时**的已知投影；源 session log 和 SQLite 不是跨库事务，本层无法证明快照是否追上源尾、缺页、取消或后续 append。输出 `freshness:'unknown'` 恒为未知，不把 source 未知/不完整标为完整，也不能根据 cursor 相等推导实时同步。后续 adapter 应负责安全、幂等的真实日志重建以及身份和 source 世代变化处理，且在无法证明完整时保持 unknown。

内部测试模块的 `migrate(database)` 仅供合成内存迁移测试，不是包公开 API；它要求 `node:sqlite.DatabaseSync` 主库为 memory 且没有 attached 数据库；v0→v1 在事务中建表并写 `PRAGMA user_version`，未来未知版本拒绝，失败回滚。它不会接受磁盘文件。没有任意 SQL 接口的 `createMemoryStore()` 拒绝文件路径、外部句柄与额外配置。

## 验证与后续授权

```sh
node --test packages/personal-telemetry/test/*.test.mjs
```

测试只使用 `:memory:` 和人工生成数据；不会创建/清理测试文件，也不读取真实会话。真实持久化尚未实现：需要用户明确授权路径、安全目录、0600 建库及 WAL/SHM 权限/竞态验证、migrations、崩溃恢复，并验证不能跟踪到非授权链接路径。导出、清除和针对真实数据的任何操作必须另行取得用户确认，当前不提供这些 API。spec 的逐 turn/tool/workflow 数据、跨会话聚合、保留策略和查询层均不在此原型内。

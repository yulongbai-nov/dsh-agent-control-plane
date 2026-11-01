# Workflow provenance 纯合成关系模型（研究，不可部署）

**本目录不是来源认证、权限服务、持久层、真实 Host、引擎或投影适配器。** 只用普通 Node 的内存对象演练 receipt 形状、关系冲突和未知态；scope、所有 identity、definition、sourceTag 都由调用者自报，任何人可伪造。输入没有 version/codec、签名、host mint 或授权接口；不可将结果当成来自真实 session/tool/engine 的事实。即使 `relation: 'consistent'` 也**仅表示本模型有限字段的合成关系未见冲突**，不是来源认证、已完成执行、已授权或可供 `workflow-board-projection` 的 `sourceBinding: verified`。`requiredProvenance()` 永远返回 `{status:'unsupported'}`，无论调用者提交何种声明，且不读取其参数。

所有 ID 仅允许 `fixture-` 开头的受限占位格式，来源仅允许 `synthetic-source-a/b/c` 固定占位标签；标签不是脚本、摘要、source 存储许可或原始/有效/accepted 之间可验证的转换证据。ID 本身不保证不含敏感内容，因此**调用者不得传入真实数据**。本模型不接用户 session/profile、实际脚本/正文、模型或网络，不运行用户脚本、不写持久库、不加载 DSH 或启动服务；内存状态进程退出即丢。若将来保存实际 accepted source，必须单独取得授权并设计用途、范围、披露、保留及删除策略，结构一致与散列均不是许可。

## 合成输入与示例

只接受普通/null-prototype、enumerable 自有数据属性的平面对象；reject Proxy（包括 revoked）、getter、符号键、陌生字段和自定义原型。所有字段必填，除 `lifecycle` 的 `start` 没有 outcome；全局每个模型最多 128 个**不同** receipt（冲突 variant 也计数），ID 总长上限 64 个 ASCII 字符，eventSeq 为非负安全整数且不能是负零。原始输入经校验后复制并冻结；输出为新建、递归冻结的合成快照。错误仅为固定 `INVALID_RECEIPT`、`INVALID_OPTIONS`、`LIMIT`，不拼接原输入。实现依赖同 realm 未被污染的 JS 内建；`Reflect.ownKeys` 在检查键数之前可能先分配巨量 keys，不能称抗 OOM/敌对进程或安全沙箱。

五种 v1 **内存形状**（不是可迁移持久化协议）：

| kind | 自有数据字段（每种都包括 `kind`, `workspaceId`, `sessionId`） | 合成含义 |
| --- | --- | --- |
| `scope` | 无其他字段 | 调用者声明的 workspace/session 范围，不代表授权。 |
| `origin` | `generationId`, `eventSeq`, `callId`, `sourceTag` | 声称的原始事件引用和原始来源占位标签。 |
| `attempt` | `generationId`, `eventSeq`, `callId`, `attemptId`, `definitionId`, `effectiveSourceTag` | 声称的一个 terminal/leaf attempt 及 wrapper 后有效来源。origin→attempt 为 0..N；没有 terminal 注册表或 wrapper lineage 校验。 |
| `accepted` | `attemptId`, `runId`, `sourceTag` | 声称的 attempt→run 和引擎 accepted 来源；不存在实际引擎或 guest 交付验证。 |
| `lifecycle` | `runId`, `phase` 为 `start`，或 `phase` 为 `end` 并带 `outcome` (`completed`/`error`/`cancelled`) | 合成观察声明；不带原生事件位置，不建立时序。 |

```js
const { validateReceipt, createModel, requiredProvenance } = require('./index.cjs')
const model = createModel({ maxReceipts: 8 })
model.observe({ kind: 'scope', workspaceId: 'fixture-w1', sessionId: 'fixture-s1' })
model.observe({ kind: 'origin', workspaceId: 'fixture-w1', sessionId: 'fixture-s1',
  generationId: 'fixture-g1', eventSeq: 1, callId: 'fixture-call1', sourceTag: 'synthetic-source-a' })
const snapshot = model.read() // scope incomplete；不是“没有 attempt”的完整证明
requiredProvenance() // { status: 'unsupported' }
```

`validateReceipt(receipt)` 仅验证上述格式并返回独立冻结对象；`createModel({maxReceipts?})` 返回冻结的 `observe(receipt)` / `read()`，不得注入任意 issuer 或通过 Boolean 切换可信状态。receipt 不可使用 `version`、`verified`、脚本或别的字段；输出 `version:1` 仅描述这个进程内快照形状，**不是输入 wire 协议**。本例所有数据均为合成占位。

## 归并、冲突、未知

- 逐条校验并做 immutable 去重；相同 typed key 与内容重复可幂等重放。origin key 是 `(scope,generation,eventSeq)`，attempt 与 accepted 各以 `(scope,attemptId)`，lifecycle 以 `(scope,runId,phase)`；scope 为 `(workspaceId,sessionId)`。**不同 workspace 可以复用同一 sessionId**：这是两个独立 scope，不因同名 session join 或产生冲突；不得假设 sessionId 全局唯一。跨 key 引用仅在字段严格相等时关联，不按名称、时间或抵达顺序猜测。归并顺序只影响呈现的稳定排序，不是排序/修复原生日志。
- 同 key 不同内容、同 generation 与 scope 下同 call 多个 origin event、同 scope 不同 attempt 声称同 run，会隔离冲突与相关链；同 attempt/run ID 被不同 scope 声称时两边保守隔离（可能误报，不代表已证伪造）。冲突有固定 diagnostics 且后来重放原值也不消失。call 引用与当前唯一 origin 不匹配视为 incomplete，不拼接；不同 generation 不关联，即使 eventSeq 相等。
- 每个独立 origin 都要求观察到至少一个与之匹配的 attempt，否则该 origin 和 scope 都为 `incomplete`，即使同 scope 的另一条链结构完整；`attempts:0` 只是当前观察数，既不证明无 attempt，也不否定真实 0..N 的可能性。后续 arrival 即使补上完整关系，`consistent` 也仅表示当前有限字段的合成结构一致，不代表无遗漏、无额外 attempt、真实事件完整或已授权。空 scope、origin-only、缺 scope/origin/attempt/accepted 的链同样不能视作完整证明。
- 永远输出 `sourceCoverage:'unknown'` 和 `jobOwnership:'unknown'`，不接受 source-cut/job receipt，不根据其他证据推断 durable source、已注册 job 或恢复状态。`lifecycle` 永远为 `unknown`：输入不含原生有序事件，因此即使同时见到 start 与 end，`observedEnd` 也仅是合成 end 声明（否则为 `null`），不代表真实完成、真实时序或可恢复状态。冲突或关联不完整时屏蔽 end 声明。
- 达到数量上限后，如果再输入一个不同的合法 receipt（可能恰是冲突），会抛 `LIMIT` 并永久使模型进入 `state:'overflow'`、快照隐藏全部 scopes、之后写入均失败；不能因容量不足继续输出先前一致的结论。已存在的完全相同重放不消耗容量；非法输入不改变状态。想重新演练必须建立新模型，新模型不应被当作旧模型的冲突恢复或持久 replay。
- **每次 `read()` 或 `observe()` 返回的冻结快照仅是当时的历史值，不能撤销或自动更新。** 后续 conflict/overflow 不会改变已经取走的旧快照；调用方不能缓存旧的 `consistent` 当作当前事实。未来真实应用需要受授权的重新读取与明确的 revision/version 和失效通知机制（含通知丢失后的重读/核对）；本原型没有 watcher、revision、订阅或实时失效保证，输出中的 `version:1` 仅是形状版本，不是单调 revision。

## 与未来真实机制的边界

未来实现至少要分别证明 Host 已授权的原始事件、实际 terminal definition/dispatch attempt、工具→run/job 所有权、引擎封存并真正交付 guest 的 accepted source；此外 durable source cut 与 lifecycle 是独立证据。当前均无实现，不能用 caller Boolean、ID 或散列替代。现有 rc.5 `begin` 存在可变引用和重复响应，构造时快照不必等于 guest 实际使用内容；见 [原生负例](../workflow-accepted-init-spike/README.md)。启用前历史及 in-flight 不能凭旧事件补成认证。

如未来需要**持久** accepted 先于 dispatch，须另行定义显式 opt-in 的异步 write-ahead admission：封存实际 guest 所用 init → 可幂等提交 receipt → 才调度，处理已提交未调度、未知写结果/崩溃、取消及跨存储非事务。这里没有 admission harness、存储或实际调度；不承诺这种机制或改写现有同步 start。

## 离线测试

```sh
node --test packages/workflow-provenance-model/test/*.test.cjs
```

覆盖严格数据属性、代理/getter、合成 ID/source 上界、冻结、重放、反序、scope/generation 及冲突传播、0..N attempt、缺边、unknown、overflow fail-closed 和 required unsupported。测试不访问安装包或用户数据；不验证产品行为、权限、生产身份、持久恢复、跨进程或恶意内建。
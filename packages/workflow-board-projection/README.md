# Workflow 运行投影

纯函数：把同一 run 的 rc.5 持久 session events 折叠为生命周期和**保守**静态节点匹配。不执行脚本、不读盘、不订阅事件、不安装插件，也不渲染 UI。

```js
const { projectWorkflow } = require('@dsh-agent-control-plane/workflow-board-projection')
const board = projectWorkflow({ runId, topology, layout, events, parentSessionId })
```

参数：

- `runId` 非空字符串；`topology` 和 `layout` 分别为 `workflow-topology` 的静态输出，调用前由宿主取得。输入绝不修改；投影直接返回这两个对象，运行状态不会重排坐标。外部不可就地改写输入；同一静态输入产生相同坐标。
- `events` 是同一父会话**按日志顺序**给出的全量原始 session 事件（`{type,seq,time,data}`）；函数只处理属于 `runId` 的四种 `tool-workflow/*` 事件。过滤后的 eventSeq 若重复或递减，则告警并拒绝绑定；不会排序掩盖错误。后缀重复 / 历史截断 / 丢失数据不能视作完整证据。
- `parentSessionId` 可选，由宿主提供真实上下文、原样带回，**不验证**子会话亲属关系或打开权限。
- 默认没有可靠的脚本↔run 关联，所以所有尚有 label 的 invocation 均为 `source-unverified`，不会映射静态节点。只有调用方从可信外部数据源**实际证明** `runId` 与该份 `topology`/源脚本属于同一工具调用时，才可传 `sourceBinding:{status:'verified',runId,toolCallId}`。这是调用方的事实断言，不是安全认证；仅提供字符串不能构成证明。**不能以 workflow 名称相同、最近的工具调用、日志顺序、人工猜测作为关联。**本包不会从原始事件推导此证据。rc.5 `tools/result` 在结果成功时可同时观察 `exec.callId` 与 typed `result.value.runId`，只是未来宿主可研究的**候选**关联 seam，不是认证凭据：scoped 工具可同名覆盖，插件可替换结果。仅在可信插件链前提下，并由宿主独立核验真实工具身份、父会话及同一 tool call 的 script/meta，才能建立关联；仅凭事件与工具名不得标 verified。外置插件不得调用非仓库插件禁止使用的 `appendPluginRecord`；若采用独立 storage domain 侧存，需处理与会话日志非事务及失败恢复。失败/取消、监听插件后加载、桥接或持久化失败时仍必须保留 unverified。

输出 `{version:1,runId,sourceStatus:'verified'|'unverified',parentSessionId?,topology,layout,run,statusByNode,unmatched,events,diagnostics}`。`run={name?,status:'unknown'|'completed'|'failed'|'cancelled'}`；`run-end.stopReason=error` 映射 failed。`statusByNode[nodeId]` 和 `unmatched` 的运行记录为 `{seq,label?,phase?,childId?,status,reason?}`，其中 `seq` 是 **agent 调用**的序号。`status` 是已观测到的 end outcome 或 `unknown`；没有 end 不等于 running，因为后台可跨 turn 运行，日志写入亦可能中断。静态未绑定节点也应显示 unknown，不是 waiting。`unmatched.reason` 包含 `source-unverified`、`incomplete-topology`、`template`、`ambiguous-static`、`ambiguous-runtime`、`invalid-events`、`missing-start`、`conflicting-seq`、`no-candidate`。`events` 只包含白名单安全摘录字段：`{type,runId,eventSeq?,time?,seq?,name?,label?,phase?,childId?,outcome?,stopReason?}`，按输入顺序；`eventSeq` 是 session 日志序号，`time` 是 session 时间毫秒，均不能与 `seq` 混淆。`diagnostics` 为 `{code,seq?}`；未知或无效条目不得被伪装成完成。

每次重新根据全部事件重算匹配，而不是单向持久化匹配结果：新增与已绑定节点竞争的调用时撤销原映射。只有已验证 source、拓扑 `complete===true`、一个匹配确定 label/phase 的 `single` 静态调用点与一个 runtime 调用时才输出匹配；未知节点可能竞争、相同 label 的多候选、template、缺开始、seq 重复/错序、孤儿 end、无效记录均不猜。任一 invocation seq 存在冲突时，其他所有绑定也保守失效；冲突 invocation 的 outcome 标为 `unknown`。静态 `phase:null` 与无 phase 的调用匹配是必要的保守假设：若 runtime 明确给出 phase 则不绑定。实际状态、phase、静态输入或会话在源头被截断时，宿主应使 source 保持 unverified 或将 topology 标为不完整。

## rc.5 数据来源与缺口

- `dsh-tool-workflow/lib/index.js` 的 recorder 对根 transport 追加四种 log-only 事件：run-start `{runId,name}`、agent-start `{runId,seq,label,phase?,childId}`、agent-end `{runId,seq,outcome}`、run-end `{runId,stopReason}`。session 层补 envelope `seq` 与 `time`。每次 run 首次 append 失败后不再记录该 run，可能只有前缀；嵌套 transport 不持久化。
- 引擎 `workflow/phase` / `workflow/log` 观察事件不由该工具作为逐条 session 事件持久化；后台 job 输出有短暂观察，不是会话日志。持久 agent-end 没有 label/phase/childId，须按同 run invocation seq 关联 start。没有 model、usage、duration、retry、output；不能捏造。
- `childId` 本身不证明此时可打开。官方 UI 仅对 live child、`parentId` 与当前父 session 相同并且真实 subagent projection 有 mode 的成员导航。调用方必须独立验证真实的父 ID、mode、当前权限及 live 状态。
- 此包不读取原生 host 投影，也不将 run 事件绑定到工具调用；它不是 DSH 插件或完整 P2b 实时集成。缺失来源时保留 unmatched。不能据此推断用量、模型或耗时。

零安装测试：`node --test packages/workflow-board-projection/test/*.test.cjs`；若需一起验证真实 topology parser 互操作，请用本机已有 Acorn：`NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" node --test packages/workflow-board-projection/test/*.test.cjs`。不提供 Acorn 时仅跨包解析用例显式 skip，其余用例仍执行。

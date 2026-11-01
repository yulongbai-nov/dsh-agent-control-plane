# rc.5 workflow 源候选观察器（实验性基础模块）

**CR-007 隔离：仅保留作合成研究，不安装、不加入任何 profile、不接真实宿主或用户会话。** 只在内存里从公开的 `tools/result` **同步**抓取少量数据；所有候选均为 `unverified`，不是认证，不自动升级 `workflow-board-projection` 的 `sourceBinding.status`。这是 private、零依赖 CommonJS 模块，不是可安装插件；不启动、包装或重跑工具，不执行脚本、不轮询、不订阅 `session/event` 或 `workflow/*`，不读写会话、文件、数据库或网络。它本身尚未接入 GUI。

仅为已知 rc.5 伪造/冲突反例和回归测试保留；待可信 accepted-init 和原始调用身份 seam 建立、授权/资源边界经实测且反例迁移到回归测试后，再审议移除该研究包。当前无到期时间，删除仍须用户批准；保留不表示将部署。

## 最重要的限制：事件并不证明工具身份或 run 来源

rc.5 的 `tools/result` 是最终结果的只读观察点，但可见的 `exec.name` 只是工具名。真实工作流工具的 `toolName` 是可配置的，且同名 agent-scope 工具会遮蔽全局注册。`tools/execute` 包装器可以不调用工具就生成一个成功结果；`tools/post-execute` 可替换成功的 `result.value`（包括 `kind` 和 `runId`）。因此：**即使所有字段均匹配，本观察器也不知道真正执行了哪个工具，或观察到的 runId 是否来自实际执行。**结果结构的校验不能证明来源。`exec.signal` 只能看到最终事件时的状态；恶意/非预期包装器及绕过实现亦不受本模块认证。

本包给出的 candidate 与 adapter 只能说「在此进程观察到了同一最终事件中的这些值」，不能说明它们是实际 workflow run 与源的绑定；不能因名称、最近记录、run 名称、事件时间等匹配而标为 verified。投影包只验证 `{status,runId,toolCallId}` 的形状，并将 `verified` 视作**调用方的事实断言，不是认证**。如果其他系统要升级此状态，必须由独立、可信的宿主证据覆盖**实际执行定义及 agent scope、同次 tool-call/session、实际引擎接收的完整 script/meta、最终 runId、执行与结果未被包装/替换或其对应关联可经独立验证、完成/取消状态、全量冲突及正确的 topology 输入**；缺一项或有疑点均保持 unverified。仅仅调用 `ctx.tools.get`、核对 schema、传布尔开关，或下方示例代码都不是该证明。本模块不提供 verified 适配器。

后台调用成功只说明 job/run 启动，之后可能失败或取消；本模块不再观测 job 结局，所以**全部拒绝** `kind:'background'` 和请求后台的事件。前台正常 workflow 实现只在 completed 时成功，失败、取消会报错；但这是在确实运行了原版工具且结果未被替换的条件下的结论。因为不能验证这些前提，所有候选仍是 unverified，不能宣称完全排除了被伪装的取消/失败。

## 用法

宿主必须自己获得已经核实的当前部署配置的工具名；不能假定是 `workflow`，也不能从用户数据猜测。以下是调用示意，不是将本包安装到 profile 的步骤：

```js
const { createSourceObserver, attachSourceObserver, projectObservedWorkflow } = require('@dsh-agent-control-plane/workflow-source-observer')
const { extractTopology, layoutTopology } = require('@dsh-agent-control-plane/workflow-topology')
const { projectWorkflow } = require('@dsh-agent-control-plane/workflow-board-projection')

const observer = createSourceObserver({ toolName: configuredToolName }) // 必填，无默认
const detach = attachSourceObserver(ctx, observer) // ctx.on('tools/result', ...)

// 在事件回调以外，且宿主已确认访问该父会话的权限时调用。
const board = projectObservedWorkflow({
  observer, sessionId, runId, events, extractTopology, layoutTopology, projectWorkflow,
}) // 找不到候选返回 undefined；找到则投影固定 sourceStatus='unverified'

// 生命周期结束时，不再接收事件并丢弃内存中的原文（若不再需要）：
detach()
observer.clear()
```

`createSourceObserver({toolName,maxEntries?})` 返回 `observe(exec,result)`、`get(sessionId,runId)`、`clear()`；宿主只需用 `attachSourceObserver` 监听，回调同步、返回 `undefined`，异常不会逸出。`get` 返回**深度隔离的新数据**，只读一个 `{status:'unverified',toolName,sessionId,toolCallId,runId,script,meta:{name,description,phases?:[{title}]}}` 候选，不返回 live `exec`/`agent`/`signal`/完整参数或结果。`meta` 对外只保留当前 `workflow-topology` 使用的 phases.title 及工作流必填 name/description；内部额外缓存整个 meta 的 JSON 序列化 SHA-256 供重复冲突检测，不把摘要作为认证证据，也不保存其他 phase 或 meta 原文、args、result、jobId。JSON 属性顺序变化会保守视为冲突，摘要可能暴露低熵值的存在性；源脚本本身也可能包含敏感内容。

`projectObservedWorkflow` 接收纯同步的 `extractTopology`、`layoutTopology`、`projectWorkflow` 依赖，始终使用所捕获的 script 与摘录 meta；它在解析前后再核对候选，防止解析过程中冲突撤销后继续投影。它不负责取得 events、检查会话访问权或实现持久化，**不主动监听任何事件**；请只在已有的安全刷新路径调用。即便候选存在，投影仍为 `sourceStatus:'unverified'`、不绑定静态节点。解析器、投影函数和 events 由宿主提供，解析/投影异常传给普通调用者，不能在 `tools/result` 回调中调用；不能把该适配器的 `unverified` 修改为 `verified`。宿主对 `events`、`topology`、`layout` 的使用还须遵循对应包的限制。

## 筛选、冲突与容量

- 必须是配置的精确工具名、非空父 session ID 与 call ID，`rootCallId === callId`，`exec.parent === undefined`，本进程真实 `AbortSignal` 且事件时 `aborted === false`，`result.isError === false`；必须是包含非空 runId、非负安全整数 agentsStarted 和 own `result` 属性的前台成功 value。不存在的字段不补全、不猜。PTC nested 的 `parent`/不同 rootCallId 被拒绝，包括它本身的 workflow 并不写根会话持久 run 日志的情况。缺 session、失败、取消、后台、畸形或超限均不形成候选。
- `arguments.script` 必须是字符串且最长 1,000,000 UTF-16 单位；`meta.name` 和 `meta.description` 必须是字符串（允许空串，与上游的 string schema 一致）；`meta.phases` 如存在必须是至多 1024 个含字符串 title 的对象。整个 meta 的 JSON 序列化长度、以及 `script` 加保留 metadata 文本长度之和分别最多 1,000,000 UTF-16 单位；工具名、session/call/run ID 为非空非纯空白字符串且各最多 1024 单位。输入的 `run_in_background` 只能缺省或严格为 false。使用较严的类型或大小限制造成遗漏时，不会扩大信任。
- 每个 session 内，callId 和 runId 必须一对一；摘录及完整 meta 摘要相同的重复到达为幂等；摘要不覆盖 `args` 或输出，所以不能声称所有字段级冲突都被识别。冲突或后来的无效/失败重复会撤销相关候选，并保留冲突墓碑，后续不能复活。不同 session 是独立命名空间；如果运行时真实的 ID 作用域比它更窄，宿主必须提供正确的 session ID/实例隔离。对于尚不存在候选或无足够标识的无效事件仅丢弃；已有 sessionId/callId 时内部校验抛错会撤销相关候选，但连身份字段也无法读取时无法定位撤销对象；因此本模块无法发现所有可能的冲突，不能以「无冲突」证明唯一性。
- `maxEntries` 默认 256、允许 1–10,000；内部最多保存 `2 * maxEntries` 个 call/run 索引键（冲突墓碑也占用），达到上限后的下一次新索引会清空所有记录并**停用**观察，不以静默逐出旧冲突的方式伪装安全。容量按索引键而非严格 run 数；大量不同 session 一样共享上限。`clear()` 会清空所有候选和墓碑并重启空窗口：只适用于宿主确认历史候选均已失效的生命周期边界；绝不可拿 reset 后的状态证明 reset 前的历史唯一性。停止监听调用 `detach()`；调用方还应丢弃已经拿到的候选和投影副本。

## 隐私、持久化和已知不足

脚本、名称、phase、ID 均可能包含秘密或个人信息；该内存缓存本身不会认证调用者、过滤私密 session、加密、屏蔽同进程插件或确定允许访问的范围。宿主必须在**接入并订阅之前**明确授权覆盖范围、确保对应会话的同意与访问控制，不得把这个全局监听器用于不允许观察的会话；示例不构成对任何现有会话的授权。不要把脚本/候选写日志、上传或暴露到未授权客户端；缓存会留在进程内直到 `clear()`、垃圾回收或进程退出（JS 不承诺内存擦除），且 `get` 和投影可能创造额外副本。资源限制只是界限，并非适用于高负载的持久缓存设计：`JSON.stringify(meta)` 和摘要计算发生在事件回调中，长度检查是在序列化之后；rc.5 在派发前已对参数做 JSON 快照/冻结，但超大或深嵌套 meta 仍可能造成瞬时内存、CPU 和延迟，甚至进程级资源耗尽（不能用 try/catch 防护）。不要把它用于不可信高负载，除非宿主在更早的可信边界提供严格输入上限；我们未做性能实测。没有过期、逐会话删除、跨进程共享或崩溃恢复。

**默认没有任何持久化。**重启、后安装、插件重载、未观察到前台成功事件、内存限制、断线及历史回放会使 binding 缺失，必须 unverified；不能从 session log 的前后顺序重建。未来如确需持久保存，须另获授权并设计访问控制、数据最小化、保密性、冲突/原子性和崩溃恢复；持久记录也只能保持 unverified，除非独立证据链及恢复期间的身份、完整性、会话与源一致性重新得到验证。本任务没有实现任何持久化方案。

## rc.5 源码证据及测试

只读检查安装版 `app.asar` 内对应文件（不是对当前 profile 的检查）：

- `@deepseek-ai/dsh-tool-workflow/lib/index.js:66-70,261-271`：toolName 配置及注册；`385-430`：使用 `exec.agent`、script/meta，`exec.parent` 决定根记录，前台非 completed 是错误；`218-258`：后台返回 jobId/runId，完成发生在之后。
- `@deepseek-ai/dsh-tools/lib/index.js:2969-2982,3227-3264`：scoped shadow、快照和根调用字段；`1361-1376`：PTC nested 的 rootCallId 与 parent；`3390-3438`：包装分发及取消；`3455-3522,3599-3621,3668-3705`：post-execute 可替换 value、wrapper 可构造成功值，以及最终只读 result 事件。
- Node 测试：`node --test test/*.test.cjs`。不联网、不装依赖；含隔离快照、字段/取消/PTC/后台、冲突、容量与 projection adapter。
- 可选只读集成（macOS 已安装 rc.5 Electron；在本目录运行）：

  ```sh
  ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' --test test/rc5.integration.cjs
  ```

  使用隔离的新 Cordis Context、真实 rc.5 ToolRuntime 和 workflow 插件；注入内存 fake workflowEngine / fake session，未读取 profile 或真实会话、不启动 PTC 或 LLM。覆盖自定义 toolName、真实 final event、post-execute 换 runId、around wrapper 自造成功、agent scoped 同名遮蔽与观察器异常隔离。不是实际引擎、真实会话、完整宿主集成、性能或 GUI 测试。不同 rc 版本和不同进程 Realm 的 AbortSignal 均须重新验收；本包不声称兼容其他版本。

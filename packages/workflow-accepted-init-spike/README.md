# rc.5 原生 workflow 引擎 begin 负例（合成研究）

**研究状态：未部署、未 fork、未建立可信来源认证。** 本目录的测试只加载固定安装版 `PtcWorkflowEngine`、真实 Cordis 和独立新建的内存服务容器；所有 request、事件、对 meta/args/limits 的修改、父 session 标识和 runtime 返回值均为本地合成数据。fake `ptcRuntime` 不执行 guest 程序或脚本，不创建 PTC 子进程、不调用模型、网络、真实会话或 profile，也不启动服务/浏览器、不安装包、不修改签名应用。原生引擎只对初始合成字符串进行 `vm.Script` **语法解析，不执行**。由测试调用真实 host `bindings[0].functions.begin({})`，是模拟一个 guest 请求，直接读取其返回的 detached JSON；未测试 PTC transport 或真实 guest。

**任何记录均不输出 `verified`：**一次成功的 begin 仅是该次 host binding 对模拟请求返回的 JSON，不证明真实 guest 请求了它、经 transport 送达/使用它、脚本执行、执行成功，或绑定到哪一个原始工具调用/认证主体/历史记录。多次 begin 可以不同，本实验无法证明真实 guest 使用哪次。没有 begin（包括运行前取消、runtime 失败）时没有该证据；不得根据 start、时间、调用次序或名称填补。现有同步 start 加异步 observer 也无法保证落盘成功或 write-ahead；若未来要求持久 acceptance，需另行设计显式 opt-in 的 write-ahead admission 契约，否则保持 unknown。

## 固定来源和构建边界

- 来源为本机 `DeepSeek Harness.app/Contents/Resources/app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh-workflow-ptc/lib/index.js`；归档根包与该包版本 `0.2.1-rc.5`，归档根包构建元数据 `dshBuildCommit=d4db512a969fccf0c5cc7ec8fe38e9c1d27af916`、`dshBuildDirty=false`。这是安装元数据，不是远端 tag、供应链身份或代码签名的独立认证。
- 该文件 66,267 字节、670 行、SHA-256 `c7718bc30bcdfb33de38e2011096f2edddccba536b8891c4e6ea456a41fbf19c`；主要 guest 编译源码内嵌为单个长字符串。包自身 LICENSE 是 MIT，`Copyright (c) 2026 DeepSeek`；如将来复制其代码，须保留完整版权与许可。本研究并未复制其实现。
- 编译 ESM 入口可由安装版 Electron 的 Node 模式直接读取并加载其已有归档依赖；测试通过表明**该固定本机组合**可运行合成测试，并不保证其他版本、原生 app 中完整插件链或可部署产品可构建。仅运行一个真实 provider，未尝试同时注册第二引擎。
- 测试先核对 Desktop 元数据、包版本和 engine SHA-256；不同安装应视为未知基线，不能把结果套用到其他构建。测试无需 npm install，无生成 fork、无写 app/config。

## 原生控制流与别名

下述行为针对上述 hash 的安装编译文件的只读检查，加下面的合成测试；不要推广到其他版本。

1. `start(request)` 先 `validateMeta(request.meta)`，读取 `request.script` 并解析；随后调用 `subagents.getProvider`，再读取相关参数、创建 `init`。`body` 是此处**第二次**读取的 `request.script`；`args` 先判断 `request.args !== undefined`，再读取一次并 `structuredClone`。数据访问器、代理、外部 provider 或变异使检查值与实际构造值不同，额外读取也可能改变语义。动态 script getter 实证：第一次有效并通过解析，第二次为无效 body，仍能从模拟 begin 拿到该 body；fake runtime 不解析或执行该后续字符串。此前独立子类实验的 provider 修改再恢复普通 request 属性反例见 [`workflow-engine-spike/README.md`](../workflow-engine-spike/README.md)。
2. `validateMeta` 构造新的 meta 和 phases 对象，普通数据不再别名原始 request；但校验和构造时多次读取 getter，校验通过不保证后续读取仍取到校验时的值。测试的 `name` 前两次为 `checked`、第三次为 `later`，事件及 begin 返回 `later`；不是宣称 request getter 一定调用三次，次数取决于具体形状与分支。
3. 新 meta 在 native `info.meta`、`run.meta`、`run.init.meta` 之间是**同一可变对象**。同步 `workflow/start` listener 可以改该对象，导致之前事件快照与后来 begin 结果不同，即使原始 request 没改；顶层 init 和其 body、args、limits 也暴露在返回 run 上且可变。此处讨论是合成隔离对象，不以更改真实运行数据做试验。
4. `new PtcWorkflowRun` 同步调用内存 `workingDirectory.ensure`，将 drive 排入微任务；start 同步发布 `workflow/start` 后返回。drive 等待 cwd，之后向 `ptcRuntime.run()` 提供 host binding。真实 begin 调用时才执行 `snapshotJsonValue(this.init)`，生成 detached JSON；不存在自动将初始化时或 `workflow/start` 时的快照绑定为此响应的保证。测试明确在 fake runtime 收到 binding 后，先排入修改 init 的微任务，再排入 begin 请求；此受控队列能重现变化，**不表示所有 production 调度都相同**。
5. `snapshotJsonValue` 按当次对象图取值并校验 lossless JSON，非通用的只读无副作用检测：可触发 accessor 或 proxy trap，错误可从 begin 传播。合成 getter 每次 begin 递增，两个响应不同；先后额外拷贝或冻结 init 均可能改变读取次数、时序、错误或可变性，不能称透明。

## 可复现测试切片

运行环境是已安装的对应 macOS rc.5 Electron，`ELECTRON_RUN_AS_NODE=1` 不启动图形界面。自仓库根目录：

```sh
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  --test packages/workflow-accepted-init-spike/test/native.rc5.integration.cjs
```

[`native.rc5.integration.cjs`](test/native.rc5.integration.cjs) 所有用例均为上述完全内存合成环境，具体断言：

| 切片 | 实测结论与限制 |
| --- | --- |
| 初始正常请求 | 普通 meta/args 与请求对象分离；begin 返回 JSON 与运行中 `init` 分离。该响应可被测试修改而不改运行时数据，不暗示 init 本身冻结。 |
| `workflow/start` | listener 同步改 `info.meta`；该对象就是 `run.meta` 与 `run.init.meta`，而不是原请求 meta。事件先前捕获的副本与 begin 响应不同。 |
| 返回后修改 | 修改合成 `run.init.body/meta/args/limits`，begin 返回对应新值；与原请求 body 或先前 event meta 快照不相等。没有执行这些 body。 |
| 微任务先后 | 已收到 binding 但尚未请求 begin 时，明确先排修改、后排 begin；响应可见修改。只有此受控次序得到证明。 |
| 重复 begin | 两次响应分别反映各次访问时的 init，第一次 detached，不因中途修改变动；不知道哪个（如有）被真实 guest 消费。 |
| 取消和 runtime 错误 | begin 一次后取消，再 begin 会失败；结果 cancelled 和一次 end。运行前取消不会到 fake runtime，也无 begin；fake runtime 错误则返回 error 和一次 end，未发 begin。不能证明所有取消/错误路径。 |
| 验证错误 | 初始脚本语法错误同步抛 `SCRIPT_PARSE`，无 start 事件、无 run、无 begin。只检查语法，不运行脚本。 |
| getter 反例 | script 的解析读取与 init 读取不同；meta 的验证读取与归一化读取不同；begin 对 `init.body` 访问器每次调用取值一次。均为本地对象与合成字符串。 |

这些是原生行为与**观察时点之间**的合成差分，不是 fork 与原版的差分，也不是穷尽各个代理、getter、异常、内存压力、竞态、事件订阅者或取消场景的测试。日志不输出脚本或真实用户数据；结果不持久化为产品记录。

## 下一步界限

未来研究 seam 必须逐项区分：（a）request 解析/校验值；（b）初始化时值；（c）事件发出时及后续变化；（d）一次实际 begin 内生成的响应；（e）实际 transport/guest 接受和使用；（f）执行与结果；（g）原始工具/宿主调用身份和历史耐久性。各步缺可信独立证据均保持 unknown；即便 engine/tool 两端自有 fork 也不能凭此认证原始 host invocation/dispatch。额外快照、冻结或持久 admission 需要新的明确语义、资源与失败契约和独立差分验证。本目录不实现这些机制。

# Workflow 工具来源接缝：rc.5 合成研究（不可部署）

**这是未配置、未加载到真实宿主的研究 fork，不是插件安装指南，也不是 R10/R11 的生产实现。不得安装、加入任何 profile 或用于读取真实会话、调用模型、持久存储或激活 GUI。** 它比较工具实际准备交给 `workflowEngine.start` 的请求与返回的 run/job 身份；所有输出明确为 `unverified`，不能据此断言运行了哪个脚本、绑定原始 `tool/call`，或向 topology 投影输出 verified。

**CR-007 保留条件：**仅作为固定 rc.5 的合成对照及失败证据保留；待上游或受信宿主提供经复测的 accepted-init/原始 call 身份接缝，且权限、资源、生命周期与真实实体差分测试通过后，复核是否将证据迁移至回归套件并提议移除此研究 fork。未经用户批准不得执行删除；当前没有到期时间，也不因保留而意味着会部署。

## 来源、版本与许可

[`fork.mjs`](./fork.mjs) 基于本机已签名 Desktop `0.2.1-rc.5` 内的 `@deepseek-ai/dsh-tool-workflow/lib/index.js`，安装包 `package.json` 指定 `dshBuildCommit: d4db512a969fccf0c5cc7ec8fe38e9c1d27af916`、`dshBuildDirty: false`。基线原文件 SHA-256：`9d7ccb5238318aae82cbf6ae497f00c2b45e4afa29ed430c7b5c7e7e2cd409e4`。仅复制 tool 编译入口及其已内联的小型背景 mirror，未复制工具、引擎或整库。原包许可为 MIT，版权 `Copyright (c) 2026 DeepSeek`，完整许可见 [`LICENSE`](./LICENSE)。这是安装构建的版本/commit 元数据，并非额外验证过的远端 Git tag；基于其他版本不得假定兼容。

没有一个可靠外部 observer 能从 `tools/result` 证明工具主体执行：scoped 同名工具可遮蔽，around wrapper 可直接返回成功、修改执行参数，post-execute 可替换结果。安装包真实实现只导出 `Config/apply/inject/name`，定义与执行闭包不导出；本研究只在原版工具自己的两处 `ctx.workflowEngine.start(request)` 外构造与回读旁插桩。无须修改引擎；保留工具参数、prompt、记录器、mirror、工具错误、前台信号与取消、后台 job 注册和 quiescent dispose；本次测试不运行用户脚本。测试只在独立 Context 内临时注册 fork，从不更改配置。

## 记录含义与局限

- 在 `start()` 调用之前，从工具刚构造的 request 复制 script 与 meta；成功拿到 run 后仅在 effective exec 的 session ID、call ID、rootCallId 与 run ID 都是 own-data 字段时产生候选。**真实 rc.5 的普通 ReactLoopAgent、Session、PtcWorkflowRun 合成组装中，`agent.session` 与 `run.id` 确为 own data，但 `Session.id` 是 prototype getter；因此这个研究 fork 根本不会产生候选**（测试中的简化 fake session 才有 own-data id）。读取 getter 或从 header 提取 id 的可信、兼容权限接缝尚未设计，不能绕过这个限制或把 fake 结果称作可用生产方案。后台还必须等 `jobs.start()` **成功返回并完成工具原输出对象构造**，才记录实际返回的 jobId；如果 starter 已成功但 registry 随后抛错，仅保留 run 候选，不虚构已注册的 job。`start()` 自身抛错则无 run 候选。真实 `LocalJobRegistry` 的 handle.id 在 starter 内存在，并不保证后续一定注册成功。
- 此记录是**工具传入引擎前的请求快照和有效 exec 的候选**，不是引擎 `accepted init`。rc.5 `PtcWorkflowEngine.start` 在解析与构造 init 之间可能调用同步外部 hook 修改 request；`workflow-core` 的真实引擎合成反例也证明前后比较可被绕过。若引擎内部改写，则实际接收或执行的 body 可能与此候选不同。脚本未被执行、执行失败、取消、作业丢失时仍可能有候选。
- 这不是原始 Session `tool/call` 的认证引用。around 可改写参数、session、callId 或根调用关系；即使候选有相同 ID 或内容，不能证明原事件及权限，不能按名称、时间或结果猜。若今后需要可靠绑定，须以授权宿主能力独立验证 session、准确原始 event seq、call/agent/root、原始与有效参数区别、运行路径以及可信不可变 accepted init。嵌套 `exec.parent !== undefined` 时 rc.5 原工具不写顶层原生四种 `tool-workflow/*` 记录；不能补造。
- 脚本和 meta 可能含机密，**本实验仅在内存保留**，不打印脚本/args，不写日志、不导出网络、不开放模型或远程工具。`candidatesFor(ctx)` 是测试专用方法，返回独立快照；其权限控制、生命周期、跨进程或真实宿主隐私边界尚未设计。调用者不得据此访问真实用户数据。插件上下文 dispose 后清空。即使使用脚本哈希也可能泄露低熵信息；真正持久化前须单独取得授权并设计保留策略。
- 候选数组限制 32 条、每条 script 加 meta 估算≤1,000,000 UTF-16 单位、总估算≤2,000,000；超额丢弃新项。meta 深度≤32、节点≤10,000、每个数组长度≤1024且必须稠密、每个对象≤1024 自有键、文本预算≤65,536。禁止 accessor、Proxy、符号、自定义原型、own `toJSON`、稀疏或扩展属性数组、cycle、非有限数与 -0；共享但无环对象会分别复制。结果不借助 `JSON.stringify`，避免 inherited `toJSON`。这些只是保守丢弃策略，**不保证资源安全**：`Reflect.ownKeys` 对巨大普通对象会先分配所有键，可能造成 CPU/内存瞬时高峰；其他未知输入或运行时内建被篡改也可能改变行为。建议未来上游在受信任的冻结入参／accepted init seam 以受控资源捕获，而非直接部署此 fork。
- 观测异常按局部 try/catch 忽略，测试证明模拟快照异常不改变测试中的原生结果；**不是对所有副作用、时间、OOM、原型污染或恶意引擎的无影响证明**。快照在 `start()` 之前同步消耗 CPU，实际会推迟 start，不能宣称零副作用或完全等同原版。本机一次普通 Node 合成样本（每规模 20 次，16/128/512 个短 phase）中位分别约 0.019/0.068/0.293 ms、最大约 0.482/0.314/0.462 ms；这是仅供理解同步延迟的微基准，不代表分位保证、所有负载或资源安全。在无记录、资源上限或生命周期中断时永远保留 unknown。
- 此内存候选没有耐久性、持久序列或授权，不是伴随存储/read-model。原生 Session 记录及独立存储彼此无事务；崩溃、追加失败、旧日志或后台任务未结算都必须保留 orphan/incomplete/unknown，不能推测补全。

## 合成验证

普通 Node 单元测试（无任何 DSH 安装依赖）：

```sh
npm test
```

以下在此目录使用现有 macOS 安装的 Electron Node mode、真实 rc.5 Cordis、SystemPrompt、ToolRuntime、`LocalJobRegistry` 和原工具实现；[`test/rc5-loader.mjs`](./test/rc5-loader.mjs) 仅为测试定向解析 fork 的两个依赖，不安装依赖或修改应用包：

```sh
ELECTRON_RUN_AS_NODE=1 \
  '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  --import ./test/register.mjs --test \
  test/fork.rc5.integration.mjs test/native-entities.rc5.integration.mjs
```

测试构造内存 agent/session、预定值 engine 和 fake job，比较原工具与 fork 的 prompt/schema/presentation/输出、前台成功/失败/解析拒绝、signal abort、后台 output/cancel/dispose、mirror progress/log、四种原生 run/member 事件、guard/disabled/准入拒绝、scope shadow、around 短路/重写和内部请求变更。另在真实 `LocalJobRegistry` 上用 synthetic owner/engine 验证可访问性、owner 拒绝、取消和生命周期。`native-entities` 测试使用真实 AgentLoop、Session、ToolRuntime 和 PtcWorkflowEngine，但底层 PTC runtime 仍为不运行代码的 inert stub，确认了真实 Session ID accessor 导致零候选。测试不启动真实 PTC 子进程、模型或网络，不跑脚本、不接用户会话、不写持久数据、不验证真实 GUI/崩溃恢复。相同测试通过不等于所有配置或并发路径都无回归。当前限制条件和下一步决策需 Lead 审查；本包不申请替换任何工具注册。

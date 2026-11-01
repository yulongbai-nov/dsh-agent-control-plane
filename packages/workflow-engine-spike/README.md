# rc.5 workflow 引擎子类研究（未集成）

**结论：仅凭 `super.start(request)` 前后观察，无法无副作用地证明某段 script 对应 run。这里没有可安装插件、产品观察器或持久化实现；所有观察到的候选均为 unverified，不能传给 projection 的 verified 来源。** 不重跑用户脚本，也不接真实请求。

## 真实 API 与隔离观察

本机安装的 rc.5 `@deepseek-ai/dsh-workflow-ptc` 导出 `PtcWorkflowEngine`；其是 `@deepseek-ai/dsh-workflow` 服务定义的子类，依赖 `subagents`、`ptcRuntime`、`sandboxPolicy`、`workingDirectory`。`workflowEngine` 是同 scope 单服务：同 scope 第二次 provide 被 Cordis 拒绝；实验是**单个研究子类作为 provider**，不是同时安装两套服务。

真实 `start` 先同步验证 meta/script 和 provider、生成 id、建立原生 run，构造中同步调用 `workingDirectory.ensure`；然后同步广播 `workflow/start`，最后返回 run。run 的 `drive` 在 promise microtask 开始。合成测试中，子类在 `super.start` 后、fake runtime 之前可观察 run.id 和入参引用；观察器同步抛错/异步拒绝由测试子类吞掉，不改变测试中原生结果、cancel、dispose 和 `workflow/end`。原生验证失败保持同步抛错、无 run/观察事件。异步 sink 的长期执行、外部副作用及拒绝以外的耗时无法被该 `try/catch` 约束，不能据此声称生产环境绝对零影响。

## 已验证的关键反例

测试使用真实引擎实现、真实 Cordis 和**纯内存 fake** services；fake runtime 不启动进程、不执行脚本。请求的 `script` 是普通 own data 字符串，初始 `return 1;`：

1. 原生 `start` 在首次解析后，同步调用 fake `subagents.getProvider`；该方法把 `request.script` 改成 `return 2;`。
2. 原生引擎随后把 `return 2;` 写入内部 init；同步 `workflow/start` listener 再把 request 恢复成 `return 1;`。
3. `super.start` 返回后，研究观察者读到 `return 1;`；fake runtime 接收到的 `bindings[0].functions.begin({})` 所给 `body` 实际为 `return 2;`。

因此，即使前后都核对同一个普通属性，**观察值也不是已接受脚本的证明**。另一个真实测试确认普通 `script` getter 被原生启动读取两次，简单观察再读一次会执行第三次，可产生额外副作用。读取代理、getter 或可变 parent/meta、调用有能力访问原请求的 sink，均不能保证纯观测和保留原生语义。研究版候选实现已移除，不用复杂 clone 给生产接口制造虚假的安全感。

预先复制或冻结入参也不是透明替换：可能改变 request 的身份、属性读取及 getter/proxy 时序、可变对象和原型、parent/signal/agent 对象语义，甚至由额外读取触发副作用。要建立可信来源，需要另行设计由引擎发布/返回的不可变 accepted-init 证据或宿主可审计的受控边界，并单独验证语义、隐私、取消及存储；本实验没有实现它。

## 未解决的关联与界限

- WorkflowEngine 的 request/run 接缝不提供工具 callId、jobId 或来自特定工具的可认证身份；run.id 与 parent session 不能证明一一对应哪个 tool call，也不能证明经过未被遮蔽或中间件替换的工具。禁止按名称/时间猜测或冒充 projection verified。
- 引擎 `workflow/start` 同步发生在子类观察之前；不保证订阅者、profile 持久化、历史回填或跨进程可靠性。脚本/meta 可能含敏感信息；此目录只用无秘密合成字符串、不写会话或数据库。
- 测试未启动 GUI、PTC 子进程、网络、模型、真实用户会话，未安装依赖，也未改 profile/app.asar；也不证明完整生产插件链、后台任务、并发隔离或升级兼容性。合成请求的脚本只供原生引擎做语法检查，**从未执行**。

## 复现

```sh
node --test packages/workflow-engine-spike/test/offline.test.cjs
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' --test packages/workflow-engine-spike/test/rc5.integration.cjs
```

第二条仅在对应本机 rc.5 Electron 存在时可运行；路径只用于只读测试探针，并非产品依赖。测试用新建内存 Cordis Context，所有服务为内存 fake，结束时 dispose。

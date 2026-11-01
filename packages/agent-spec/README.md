# Agent Spec：保守静态预检原型

**不是 R6 实现、不是插件，也不是启动前的安全门禁。** `checkAgentSpec` 是无依赖、无 I/O 的纯函数，仅供研究合成输入。它不读取模型/注册表、真实 profile/session，不调用子代理、不申请权限、不发送或执行任何请求。原始 spec 的功能（team spawn、workflow 透传和全路径深度预算强制）未实现。

## 接口及结果

```js
import { checkAgentSpec } from './index.mjs'
const result = checkAgentSpec('spawn', {
  preset: 'standard',
  overrides: { provider: 'codex', model: 'example', maxTokens: 2048 },
})
// { status:'unknown', approved:{agentPreset:'standard', agentOptions:{...}},
//   findings:[{level:'unknown',code:'RUNTIME_NOT_VERIFIED'},
//             {level:'unknown',code:'DELEGATION_POLICY_UNKNOWN'}] }
```

`status:'reject'` 时无 `approved`；已识别后端且仅通过静态字段/能力预检时 status **仍是 `unknown`**。`approved` 只是与 rc.5 `SubagentStartRequest` 字段同名的、经静态预检的分离副本（为空对象亦不表示运行获准），不构成路由、模型、effort、preset、权限、额度、可续聊或启动成功的保证。未知后端为 `unknown` 且**没有** `approved`，避免把不知能力的字段静默透传。`findings` 只给固定代码，不回显错误、输入或潜在秘密。

当前只接受 spec 顶层 `preset`（非空字符串）与 `overrides`（普通对象，包含的键均须有值）。每层先拒绝 Proxy（包括 revoked），再拒绝 Node `util.types` 暴露的常见 exotic brands（即便人为将其原型改为 null），只接受本 realm `Object.prototype` 或 null 原型；跨 realm 普通对象、数组、已识别的 exotic 对象和其他原型均拒绝。JavaScript 没有保证识别所有经原型篡改的 exotic/宿主对象的通用 plain-object 判断，此处不能声称穷尽所有 exotic。每层只枚举一次 own keys，拒绝未知键、symbol、非 enumerable 或 accessor 属性；按 own data descriptor 的值快照、校验并复制，**不会执行输入 getter/setter 或读取继承字段**。getter 返回 Promise 的旧路径已移除；但不会对外部创建或在别处触发的 rejected Promise 兜底。

为保留已有 API，输出 `approved` / `agentOptions` 仍是普通 `{}`，写入采用 null-prototype descriptor 的 `Object.defineProperty`，不触发已存在的同名 `Object.prototype` setter。**但如果共享 `Object.prototype` 已有 `subagentDepth` 等 getter 或数据属性，调用方直接做 `approved.agentOptions.subagentDepth` / `in` 仍会看到或触发继承属性；这不是副本中的 own 数据。** 调用方只应按已知白名单检查 own data descriptors（而非直接读取任意继承属性），且不得直接将此预检输出用于真实启动。若后续需要隔离所有继承属性，须另设计并评估 null-prototype API 兼容性。

这里仅排除上述有限的输入对象 accessor/Proxy 与输出继承 setter 副作用；假定同 realm 内建和原型等其他基础设施可信，不能保护调用方主动执行的代码、预污染/被替换的任意内建或恶意运行环境。`Reflect.ownKeys` 要在检查键数之前先枚举并分配，巨大对象可能导致资源耗尽，不是安全沙箱或 OOM 保护。为了保守，`role`、`persistence`、`schema`、未知扩展、`reasoning_effort` 等目前直接拒绝，不表示这些功能或原生字段在其他上下文不存在；`outputSchema` 和后端可选性尚未纳入此原型。

| Synthetic backend | `preset` → `agentPreset` | `overrides` → `agentOptions` | 深度/权限结论 |
|---|---|---|---|
| `spawn` | 静态可用 | 静态可用 | `unknown` |
| `fork` | **拒绝**：继承父 preset | 静态可用 | `unknown` |
| `codex` / `claude-code` / `acp` | 拒绝 | 拒绝（即使显式空对象） | `unknown` |
| 其他 | 无可批准子集 | 无可批准子集 | `unknown` |

这些字符串仅为原型选择的能力类别；实际注册的 provider 名称可配置，不应根据名字推断运行时 provider 身份，也不自行认证、调用运行时。外部后端此处的 `codex` 指 native 子代理类别，不是 `AgentOptions.provider` 里的 LLM route；两者不能混淆。

`overrides` 只静态筛选四个 rc.5 `AgentOptions` 字段：`provider`、`model`、`reasoningEffort` 要非空字符串，`maxTokens` 要正安全整数；不假设任何 provider/model 存在，也不列死 effort 枚举（由具体模型适配器决定）。`subagentDepth` 是 `AgentOptions` 中的运行时深度计数，但 child manager 创建子级时会**覆盖**请求值，因此任何显式 `subagentDepth` 均拒绝，不把它误用为剩余预算。无法从这个预检中证明某个 agent tree 的预算/门禁或将预算原子地强制给 team、workflow 和外部后端；更不能在真实启动前放行 unknown。

## 本机 rc.5 证据（仅只读安装包，不是运行时认证）

以下均在 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内的 `dsh/node_modules/@deepseek-ai/`：

- `dsh-subagent/lib/typert.host.js` 的 `AgentOptions` 声明是 `provider`、`model`、`reasoningEffort`、`maxTokens`、`subagentDepth`；`SubagentStartRequest` 声明 `agentPreset?: string` 和 `agentOptions?: AgentOptions`。本包未发现可直接复用的完整公开运行时值校验 schema，按证据支持的最小子集筛选；AgentOptions 可被上游扩展，本原型未知一律拒绝。
- `dsh-agent/README.md`：provider/model 是初始 route、reasoning 由 adapter 决定，`maxTokens` 为正上限；`dsh-agent-loop/lib/index.js` 校验该值是正安全整数。真实模型与强度要由 LLM 运行时检查。
- `dsh-subagent-spawn-in-process/lib/index.js`：`agentOptions:true, agentPreset:true`；`dsh-subagent-fork-in-process/lib/index.js`：`agentOptions:true, agentPreset:false`。`dsh-subagent/README.md` Child presets 节明确只有 spawn 可独立选择 preset；spec §5.1 将 spawn/fork 对 preset 合并为支持不准确。
- `dsh-subagent/lib/types/out-of-process.js` 的 `NO_START_CAPABILITIES` 全 false；`dsh-subagent/lib/types/index.js` 的 `assertCapabilities` 对显式选项（包括空 options）拒绝不支持的能力。外部 backend 的 provider 级配置不等同逐次 agentOptions。
- `dsh-subagent/lib/types/child-agent.js` 的 `resolveChildAgentOptions` 先展开请求，后写入 `subagentDepth: childDepth`；`resolveChildDepth` 在提供 maxDepth 时比较绝对深度。`depth.md` 和现有 team 路径证实不是统一的会话/团队预算 gate。

本原型只是基于安装版静态证据的脱离运行时复现；实际软件版本、provider 名称/功能与路由/权限均可能变化，真实实现应在受信任宿主以真实 capability、注册表、深度策略和授权重新验证，不能把此返回值当已认证。

## 测试

```sh
node --test packages/agent-spec/test/*.test.mjs
```

仅合成输入；不运行真实后端或访问用户数据。无真实 Host/GUI/权限/深度 gate 集成测试，也不代表 R6 达成。

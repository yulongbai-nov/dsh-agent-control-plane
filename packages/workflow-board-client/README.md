# Workflow 看板组件（实验性）

Community plugin component, not affiliated with DeepSeek. 本包是**可注入的纯客户端视图组件**，不是可直接安装的 DSH 插件，也尚未在真实 GUI 注册或运行。R10/R11 整体未完成。它不注册或替换官方 `workflow-run` renderer，不订阅宿主，不读取日志、不执行脚本、不解析 AST，也不调用模型。

## 作用与输入

`createWorkflowBoard(React)` 返回 React 函数组件；React 由宿主模块表注入，不安装 React，不引用 Harness Client 包。调用者提供纯投影和数据快照，更新这些 props 时组件重渲染：

```js
import { createWorkflowBoard } from '@dsh-agent-control-plane/workflow-board-client'
// React 来自宿主，而不是重复安装/捆绑一份。
const WorkflowBoard = createWorkflowBoard(React)
// 在未来的 slot 组件里：
return React.createElement(WorkflowBoard, {
  board,               // projectWorkflow(...) 返回的 version:1 结果
  sessions,            // ctx.sessions.list 的共享快照：byId + projectionsBySession
  statuses,            // uiSession 统一状态快照 Map<sessionId, {running,...}>
  openSession,         // (target) => ctx.uiWorkspace.openSession(target)
  locale: 'zh-CN',     // 或 'en' / 'en-US'；未来适配器应连接宿主 locale
})
```

`board` 的生产方是同仓库 `workflow-board-projection` 的 `projectWorkflow({runId,topology,layout,events,parentSessionId?,sourceBinding?})`；拓扑和坐标由 `workflow-topology` 提供。视图直接使用 `topology.nodes/edges/groups` 和 `layout.nodes/groups`，不从运行事件或筛选重新计算布局；叠加的 `statusByNode` 只在来源已验证、静态拓扑完整、节点唯一且为 `single` 时显示。可显示 `events` 原输入顺序（`eventSeq` 和 agent 调用 `seq` 不互换）、`unmatched` 和 `diagnostics`。没有绑定事实时状态是「未知」，不是「等待」或「完成」。不完整、来源未验证、缺坐标以及空数据均明确提示。

仅日志中 agent-start 并不证明当前运行中，缺 run-end 也不能推定结算。日志产生的默认 `sourceStatus` 为 `unverified`；向生产方传 verified 需要宿主自己有**确切可靠证据**，不能用相同标题、最近调用或仅凭 `tools/result` 猜测。未知/歧义调用留在 unmatched，不与任何静态节点强行匹配。组件不自己生成或验证此证据。

导航与 rc.5 官方 `workflow-run` 的实时成员门槛一致：投影显示为运行中、`parentSessionId` 与 `sessions.byId[childId].parentId` 精确一致、该 child 的统一 UI 状态或摘要显示正在运行，并且其 `projectionsBySession[childId].values.subagent.mode` 确认是 `one-shot` 或 `continuable`。本组件还要求来源 verified、静态拓扑完整且静态节点匹配唯一。缺任一条件就禁用按钮。由于当前持久日志投影**不会推导 running**，仅用此投影时按钮通常始终禁用；未来的宿主必须提供经过验证的实时成员状态，而不是根据 start 或 childId 猜测。调用 `openSession` 使用确认过的直接父 ID；rc.5 返回 void，无法捕获其内部异步导航失败。

SVG 节点和表格行双向选择；列表按状态、阶段和模型筛选，不改变图坐标。图节点支持 Tab、Enter、Space，列表使用实际 button。颜色只引用 rc.5 `--dsw-alias-*` theme token，中文/英文界面由 `locale` prop 选择；将来 slot adapter 应从 Client locale 服务给此 prop 更新。style 是组件子节点，随卸载移除；没有全局 DOM、事件监听或计时器。与官方 UI 的 light/dark、实际焦点、屏幕阅读器体验尚待真实 GUI 验证，不能视为完成 R17。

## 运行测试

从仓库根目录，无需安装依赖：

```sh
node --test packages/workflow-board-client/test/*.test.mjs
```

测试包含静态位置不随事件改变、图/表双向选择与筛选、直接父级及模式校验、原序事件流、未知/冲突安全显示、不同 run 的选择隔离、zh/en 和 token 颜色；同时用真实 topology 布局函数及 projection 折叠函数生成投影，因此测试要求同一仓库存在这两个同级包；单独分发本包不附带集成测试依赖。React 和宿主依然是受控替身，不等于真实 Cordis slot、宿主在线数据或 GUI 测试。

## 尚未实现

- **宿主集成**：尚无可信证据桥接完整历史的脚本/元数据和 runId，也没有提供投影的 host adapter；`projectWorkflow` 不自行提供证据。官方 `conversation.chat.node` 的 `workflow-run` key 已占用，不能在未验证的组合语义下注册同 key 覆盖原生。未来需确定受支持的新 slot/挂载方式与生命周期，再装入真实 GUI 验证。
- 每次调用的可验证实时 running 状态增强、token/耗时/重试、输出或错误摘要、阶段折叠、大图虚拟化、真实模型计数；当前不会根据缺失字段臆造这些值。状态筛选含 completed/running/failed/cancelled/unknown，但没有伪造 retry 状态。一次渲染适合核心有界拓扑（核心最多 512 节点），尚未对大图性能做 GUI 验证。
- 客户端 locale 只提供可注入的 zh/en 文案，尚未连接宿主 locale 服务；任何由调用方提供的原始节点标签、事件字段、诊断文案不会被翻译。

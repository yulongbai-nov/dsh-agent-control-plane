# 独立会话树（rc.5 实验包）

这是 **独立主面板增量**，不是常驻在侧栏里的树。侧栏「会话树」入口打开主面板；选择会话后切回会话，展开状态在页面运行期间保留。原生 Workspace 列表和页头 subagent 目录都不改。未安装、未在运行中的 GUI 实测，暂不能宣称完整通过 R7/R8 或可直接部署。

## 能做什么

- 用根作用域 `useSessions` / `useSessionStatus` / `useWorkspaces` 展示根会话、当前目录投影和归档状态。每次展开调用 `ctx.sessions.refreshProjections(id)`；只请求被展开的层。子节点按各层 `values.subagentCatalog` 构建，打开时给 `ctx.uiWorkspace.openSession({parentSessionId, childSessionId, mode})` 传该层**直接**父 ID。收起父节点会收起它的后代；再次进入主面板保留当前展开状态。
- 会话列表/投影由 rc.5 共享 store 实时更新；根列表删除后不再显示，目录成员由宿主目录为准，**不假定**可从摘要是否缺席推断子节点被删除。归档 ID 来自 Workspace 集合，显示为归档并禁止打开，与原生 Workspace 浏览器一致。缺少可靠运行基线的目录 fallback 行显示「状态未知」，不把未知当作完成或空闲；正常结束状态只在有可用运行基线和 `subagentTiming.lastTurnCompleted` 时显示。此处的归档是 Workspace Session 归档，不是尚未实现的 Team 成员归档。
- migration-required 节点可打开但不可展开；external 条目只读且不可导航；目录读取失败提供重试，明确的空目录为叶子。`idle` 且无目录按未加载处理，已请求但宿主仍无响应时显示加载中并保留重试入口；`ready` 但无目录显示投影不可用，不伪装成空列表。`refreshProjections()` 在宿主内部会合并 in-flight 请求，重试不会强制中断卡住的请求。
- 六张内置头像来自已提供的 mock。手动选择单会话类型优先，其次按可能可见的 role、agentPreset、标题关键词推断，未知回退组长图；不会声称 rc.5 目前对所有会话暴露 Agent Spec、工具集或模型。可在面板选择本地 PNG 替换某个类型（≤180 KB，建议 144×144），也可恢复默认；会话类型和自定义图片存在**当前浏览器 localStorage**，清除站点数据会丢失，不与其他设备同步。存储不可用/满时提示且不伪报保存成功。
- 树提供方向键、Home/End、Enter/Space 和可 Tab 到的行内头像选择；扁平树为每行标注层级与同级位置，鼠标点击展开箭头后焦点返回树行。仍需真实 GUI 的键盘/屏幕阅读器验证。
- **本面板不提供在右侧栏打开按钮。** rc.5 的右侧栏只绑定当前屏幕上的会话；独立主面板激活时没有可用的会话 surface，直接打开会抛错。主会话导航返回 `void`，不承诺等到右栏挂载或历史完成，不能安全地链式打开。可先打开会话，再使用原生页头的子代理目录及其右侧栏入口。

## 运行和检查

无需安装依赖，Node 24 即可：

```sh
node packages/session-tree/build.mjs --check
node --test packages/session-tree/test/*.test.mjs
```

从本目录执行也可以：`npm test`。修改 `client.template.js` 或 `avatars/*.png` 后执行 `node packages/session-tree/build.mjs` 生成 `client.js`，再运行检查。原图是可编辑资源，生成产物把它们嵌入 ModuleLoader 单 JS，避免假设 profile 包的静态资源有公开 URL；`--check` 对比生成字节，防止模板与入口不一致。正式分发只需 package.json `files` 中列出的运行产物。

Host 侧已有只读冒烟：使用本机安装版 Electron 的 `ELECTRON_RUN_AS_NODE=1` 和 app.asar 内 Cordis，`new Context().plugin(await import('./index.js'))` 成功。测试通过真实的 `client.js` ModuleLoader factory，但 React hooks 和宿主服务是测试替身，不等价于真实宿主端到端测试。rc.5 `uiWorkspace.openSession` 返回 `void`，内部负责导航和历史加载；插件可提示同步异常，测试中的 Promise 拒绝处理仅为防御其他实现，**不能保证捕获 rc.5 内部异步失败**。注册、会话导航、权限错误和 UI 样式仍须经用户批准后在真实 GUI 实测。

`package.json` 遵循已安装 rc.5 插件的 `dsh.bundle.patch`、`dsh.client.inject`、`exports["./client"]` 和浏览器 `window.__ModuleLoader__.load` 约定。host `apply` 空实现；browser 唯一 `require` 是 host 注入的 `react`。版本门故意限定 rc.5，不使用兼容豁免。本任务没有安装包、改 profile/app.asar 或提交。以后若用户明确批准安装，才可按本机官方插件管理器的 `file:` 方案安装，并在已有 GUI 重启/刷新后手动验证，不承诺热更新。

## 真侧栏树：后续选项与差距

rc.5 的 `sidebar.panellist` 是导航图标列表，其同 ID 的 `main` 是独占主面板，不是能嵌入持续可见树的侧栏内容。要在聊天期间持续显示真侧栏树，可以：

1. **维护兼容版本的 Workspace UI fork/替换**：在现有 `sidebar.workspaces` 单席内保留原生排序、分组、归档、权限与水位线，再把 subagent 目录渲染到根行下。体验最接近 mock，但涉及较大的 rc 更新及回归维护。
2. **增加上游正式的侧栏 list/嵌套 slot**，让独立插件填充原生 Workspace 下方或每个会话行下；这需要 upstream 提供能力，外部插件不能单方面新增已被宿主渲染的 slot。直接抢占 `sidebar.workspaces` 会遮蔽原面板，不是无损组合，不建议静默采用。

尚未实现自动任务标题、Team 成员归档、树内完整原生菜单/删除动作、按工作区筛选、用户指定图案逐会话覆盖、统一 Agent Spec/工具集判定、模型读取以及虚拟化；这些不是本独立增量已经交付的功能。头像自定义策略与存储位置也和 spec 草案的 profile 资源覆盖不同。客户端递归按真实目录深度构造，未对恶意或极深（超 JS 调用栈）目录做虚拟化/深度保护；典型验收为根加三级。

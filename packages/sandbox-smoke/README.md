# rc.5 离线隔离集成冒烟（不是 E2E）

本目录的探针在**单独进程的内存**中组合本机安装版 rc.5 的真实模块和 `packages/session-tree` 的当前产物。不启动 DSH Web、监听端口或连接现有 GUI；不读取用户 profile、不启动模型、不装包、不联网、不写 app.asar；退出时释放两个 Cordis context。**这不是浏览器端到端测试或部署验收。**

## 测了什么

1. Electron Node 模式只读使用安装包中的真实 Cordis 4.0.5、`SessionStore`、`SessionProjectionRegistry`、`SubagentRuntime`、浏览器 `ClientModuleSystem`、`LocaleRuntime`、renderer `SlotRegistry` 和前端 shell 中同一构建的 `SlotCore`，以及仓库中的 session-tree Host 和实际 browser `client.js`。两个独立 Cordis context 分别代表 Host 与 client，**不是**完整 app 的进程或 profile 组成。
2. 本地 in-memory SessionStore 创建根、子、孙会话，按 rc.5 真实 `subagent/catalog` 事件格式追加模拟数据，由 rc.5 原生 Subagent 投影生成 `subagentCatalog` 视图。测试把它们**手工组装成客户端快照**，传给实际 browser bundle 的 `buildRows`／`navigationTarget`，检查各层正确父节点和 mode。事件是测试构造的，不是真正 spawn 的 Agent 或持久化记录。
3. 由 Cordis 激活 Host no-op 和通过 rc.5 ClientModuleSystem 加载的 browser factory；手动按真实 layout/sidebar 约定声明 `main` keyed、`sidebar.panellist` list。断言实际 `SlotRegistry` 注册和事件、注入 action 调用转发、重复占用拒绝；验证插件卸载/重载及声明卸载/恢复。最终关闭两个 context，断言 store session 和所有测试服务已移除。
4. 使用真实 `LocaleRuntime` 的内存模式（无 Host settings scope），测试插件注册词典、zh/en 标签切换以及卸载/重载时字典移除和恢复；未加载完整 locale 插件、语言设置 UI 或持久偏好。`React` / `react-dom`、客户端 `sessions` / `uiWorkspace` / `workingDirectory` 以及 locale bundle 的 client-store/primitives 加载依赖都是最小替身；注册的 layout/sidebar 声明是手写替身。测试不渲染组件、不执行 React hooks，也没有挂载真实 client session store、WebSocket 或 API controller。

## 只读来源和防误用

- `dsh-client-ui-renderer/lib/client.js:1290–1300,1305–1352,1368–1385,1813–1819` 是原版 registry、注入和 Cordis effect；`dsh-client-ui-layout/lib/client.js:623–634`、`dsh-client-ui-sidebar/lib/client.js:611–629` 分别声明所用 slot；`dsh-client-modules/lib/client.js:639–700,803–840,878–891,985–992` 是原版模块注册与加载路径。
- `dsh-session-projection/lib/index.js:51–66,126–155`、`dsh-subagent/lib/index.js:702–802,2982–3012` 是真实 session/catalog 注册和视图来源；`dsh-client-locale/lib/client.js:1187–1227,1278–1284,1387–1427,1517–1533` 是真实 `LocaleRuntime`、字典注册/解绑以及产品接线的依据；此处只实例化 runtime 并注入 slots，不启动产品 settings 路径。
- 浏览器 `SlotCore` 打包在 `dsh-web-frontend/dist/assets/index-BXV-oxvX.js` 中，不是独立可导入模块。探针只读取已知路径，验证 rc.5 包版本和**整个 asset 的 SHA-256**，再提取预先审查的固定边界，并校验该最小片段的 SHA-256；改版、缺文件、指纹或边界不符均拒绝。验证完整原版 renderer、module loader、locale、Cordis、session、projection、subagent 入口文件的 SHA-256 后才使用；本地所依赖的安装版模块的传递依赖并未逐个验签，仍须信任本机签名应用。更新安装包后应重新审查，不应盲改指纹。
- 唯一通过测试 VM 执行的非安装版脚本是仓库的 `session-tree/client.js`；Host `index.js` 直接作为模块导入。它们是**受信任的本地开发源码**，可能随开发者更改，运行前应审查；不接受参数指定第三方 JS。Node `vm` **不是安全边界**，本探针不能安全执行恶意插件，也不为插件禁用它可访问的所有 Node/进程能力。测试装配层没有监听网络、写文件或 profile；这并非操作系统沙箱证明。
- 本机 ESM 加载、Electron、系统工具等还会读取其自身的运行资源；这里的“只读”指测试代码的已审查操作，并不证明进程所有底层副作用均被 OS 拦截。当前脚本没有 app boot/profile loader/HMR，不会主动读取 `~/.dsh`。

## 执行

Node 24 的防护单测不依赖安装版 app：

```sh
cd packages/sandbox-smoke
node --check smoke.mjs
npm test
```

macOS 本机 rc.5 内存集成（独立测试进程、不启动 GUI）：

```sh
cd packages/sandbox-smoke
ELECTRON_RUN_AS_NODE=1 \
  '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  --test test/rc5.integration.mjs
```

需要上述固定应用路径与对应的 rc.5 安装资产。普通 Node 的 `npm test` 不包括该 Electron 专用测试。没有任何 build 阶段或安装依赖；此探针不运行 `session-tree/build.mjs`，只读已有 `client.js`。检查产物是否与模板匹配可独立运行 `node packages/session-tree/build.mjs --check`（该命令是只读检查）。

## 隔离 profile 可行性与剩余验证

安装版 `dsh-app-boot/README.zh.md:45–50,58–67,132–140` 显示，常规 profile 路径为 `$DSH_HOME/profiles/<name>`，home 级 `.env` 和 patch 仍会叠加；默认 home 为 `~/.dsh`，另有独立 `$DSH_AGENTS_HOME`（`dsh-home-paths/README.zh.md:34–52`）。换 profile 名**不等于**隔离全部用户数据。profile loader 也可产生运行时 resolution 等状态，某些组合会启动监听服务或访问远端。仅根据这些代码无法保证独立 profile 与现有进程/凭据/缓存完全隔离。

未来若用户授权在隔离环境中启动真实后端，先在明确允许的独立目录中审计并隔离 `DSH_HOME`、`DSH_AGENTS_HOME`、工作目录、环境变量、缓存、存储和进程退出；设计离线 fake LLM、禁网络及无 GUI 的启动配置，并确认不会占用现有 GUI/端口。此处**没有**创建或启动隔离 profile；当前任务禁止启动替代服务，且没有独立真实后端可供连接，所以不能证明端到端可行。

未覆盖：真实浏览器渲染与样式、屏幕阅读器/键盘、root slot 真实声明加载、client API/gateway/网络传输、真实 session-tree workspace/session stores、状态同步、插件管理器安装/发现/版本门、profile 重载、真实持久化、模拟代理启动或真实模型。测试通过不能宣称 R7/R8 完成或承诺 GUI 热更新。

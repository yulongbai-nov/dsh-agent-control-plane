# E2E 报告

> 这是 `node e2e/run-e2e.mjs --mock-model` 的自动报告（快照：2026-11-02，22 passed / 6 skipped）。
> **每个用例的录像（webm）在 Release 附件**：[`e2e-report-0.2.0.zip`](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip)（解压后打开 `report.html`，
> 内嵌每个用例的播放器）；CI 每次运行也会把最新报告作为 `e2e-evidence` artifact 上传。
> 用例说明的源文件在 `e2e/test-cases.mjs`（新增用例时同步更新）。

生成时间：2026-11-02T21:35:29.967Z
profile：`e2e` ｜ mock 模型：是（零成本）

**结果：✅ 通过 22 ｜ ⏭️ 跳过 6** ｜ 用例总耗时 43.0s

每个用例都有独立录像（`videos/`，webm）。失败用例额外有截图与 `failure-evidence` 收集的 GIF/trace。

| # | 分组 | 用例 | 在验证什么 | 结果 | 耗时 | 录像 |
|---|---|---|---|---|---|---|
| 01 | 外壳 | 打开应用后侧栏显示会话树（R7 常驻侧栏） | 打开真实 DSH Web UI，侧栏渲染出会话树（Sessions 标题、筛选框、来自 Host 的真实会话行）。验证 R7 常驻侧栏。 | ✅ | 0.9s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 02 | 外壳 | 点击新建会话，主面板出现新会话界面 | 点击「新建会话」，主面板出现输入框与工作区信息；验证会话创建入口可用。 | ✅ | 0.9s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 03 | 外壳 | 页面没有未捕获的 JS 错误 | 打开应用并渲染后，页面无未捕获异常；console 只允许已知无害的 deepseek-account 提示。 | ✅ | 2.4s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 04 | 会话树 | 会话行「⋯」菜单提供置顶/重命名/Fork/归档与头像入口（R8） | 会话行「⋯」菜单含置顶/重命名/Fork/归档 + 7 个头像选项（6 类型 + 自动识别）。 | ✅ | 0.9s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 05 | 会话树 | 工作区分组可展开/折叠，会话行来自真实 Host 数据 | 工作区分组行可折叠/展开，aria-expanded 正确，会话行来自真实 Host 数据。 | ✅ | 1.0s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 06 | 会话树 | 筛选框按标题过滤会话 | 筛选框输入不存在标题时会话行清零，清空后恢复。 | ✅ | 1.4s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 07 | 头像 | 手动指定头像后刷新仍保留，并可恢复自动识别 | 手动把头像改成「开发」→ 刷新页面仍保留（localStorage 持久）→ 可恢复自动识别。 | ✅ | 1.5s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 08 | 头像 | 每个会话行渲染头像，默认按标题推断或回退组长 | 每个会话行渲染头像图片，带合法 data-avatar-type（lead/research/code/write/data/qa）。 | ✅ | 0.9s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 09 | 插件 | Plugins 页面列出控制面全部已装插件 | Plugins 页列出 5 个控制面组件（session-tree、teams-model-override、dshmarket、local-telemetry、workflow-map）。 | ✅ | 1.0s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 10 | 插件 | 插件市场（dshmarket）在 Plugins 页提供 Plugin Market 入口 | dshmarket 在 Plugins 页提供 Plugin Market 入口并可点开。 | ✅ | 2.3s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 11 | Workflow | 侧栏出现「工作流地图」入口，打开后应用不崩溃且可返回会话 | 侧栏出现「工作流地图」入口；打开不崩溃，并可回会话（给 R10/R11 提供入口级保障）。 | ✅ | 3.3s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 12 | 真实模型（可选） | 一条短消息收到真实回复并产生 token 统计（真实登录） | 用户真实登录：一条短消息收到回复并产生 token 统计（每次 1 次调用，仅手动运行）。 | ⏭️ | 0.1s | — |
| 13 | 真实模型（可选） | 团队插件把 spawn_teammate_with_model 暴露给 agent（R1/R6 面） | 用户真实登录：一条短消息收到回复并产生 token 统计（每次 1 次调用，仅手动运行）。 | ⏭️ | 0.1s | — |
| 14 | 真实模型（可选） | 遥测插件把真实会话事件写进隔离目录（R18 面） | 用户真实登录：一条短消息收到回复并产生 token 统计（每次 1 次调用，仅手动运行）。 | ⏭️ | 0.0s | — |
| 15 | 模型 | 发送消息后收到 mock provider 的确定性回复，且零真实模型调用 | 用官方 Messages mock 作为模型层，发消息收到确定性回复；mock 记录证明零真实调用。 | ✅ | 1.1s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 16 | R17 视觉 | 中英 locale 切换后侧栏文案随之变化（切回英文） | 中英切换后侧栏文案跟随（含切回英文）。Linux CI 上跳过，由 macOS 本地验收。 | ✅ | 5.6s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 17 | R17 视觉 | 深色主题下侧栏会话树仍可见、无崩溃（切回浅色） | 真实 Settings 切换到深色主题，会话树仍渲染且不崩溃，切回浅色复核主题属性。 | ✅ | 5.2s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 18 | R17 交互 | 键盘：Enter 激活新建会话、Tab 进入会话树、Enter 打开行菜单 | 纯键盘操作：Enter 新建会话、Tab 进入会话树、Enter 打开行菜单；并记录树行不可聚焦的产品缺口。 | ✅ | 2.5s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 19 | R18 遥测 | 导出 JSON 不含正文 → purge 归零 → 新消息后 rows 恢复 | 导出 JSON（合法且不含 prompt 正文）→ purge 后 rows 归零 → 新消息后 rows 恢复。 | ✅ | 1.8s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 20 | 故障边界 | 429 限流：重试耗尽后 UI 显示错误状态且不崩溃 | 模型层返回 429，真实 Host 重试耗尽后 UI 显示可读错误且不崩溃（opt-in，需要 mock 控制面）。 | ⏭️ | 0.0s | — |
| 21 | 故障边界 | 500 服务错误：错误可读，同一实例换新会话后可恢复 | 模型层 500 → 错误可读；同实例换新会话后恢复成功（opt-in）。 | ⏭️ | 0.0s | — |
| 22 | 边界 | 快速连续展开/折叠 15 次，树状态与 ARIA 保持一致且无异常 | 连续 15 次快速展开/折叠工作区，ARIA 状态合法、无未捕获异常。 | ✅ | 2.5s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 23 | 边界 | 筛选框接受正则/emoji 等特殊字符且不崩溃 | 筛选框输入正则元字符、emoji、HTML 片段、超长串均不崩溃，清空后恢复。 | ✅ | 1.8s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 24 | 边界 | 超长标题在会话行内被截断，不撑破侧栏 | 发送超长标题消息后，会话行文本被截断（ellipsis/clip），不撑破侧栏宽度。 | ✅ | 1.2s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 25 | 边界 | 重命名 → 置顶 → 归档 → 显示已归档 → 取消归档（真实 Host 状态往返） | 重命名 → 置顶（置顶行排第一）→ 归档（默认隐藏）→ 显示已归档 → 取消归档，真实 Host 状态往返。 | ✅ | 1.4s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 26 | 韧性 | 窄视口（900×700）下侧栏可展开、树与行菜单仍可用 | 900×700 窄视口下侧栏自动收成图标栏 → 可展开，树与行菜单仍可用。 | ✅ | 1.5s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 27 | 韧性 | 连续开关行菜单 + 反复筛选 20 轮后 UI 未卡死 | 连续 20 轮开关行菜单 + 反复筛选后 UI 未卡死、无未捕获异常。 | ✅ | 1.4s | [▶](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases/download/v0.2.0/e2e-report-0.2.0.zip) |
| 28 | 取证自检 | 故意失败：验证失败取证链路（截图/视频/GIF/trace） | 仅 DSH_E2E_SELF_FAIL=1 时运行：故意失败，用于验证截图/视频/GIF/trace 取证链路（opt-in）。 | ⏭️ | 0.1s | — |

> 录像/截图路径相对本报告目录；完整压缩包见 GitHub Release 的 `e2e-report-<version>.zip`。

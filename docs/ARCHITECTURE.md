# 架构

## 1. 一句话

DSH 是「一切皆插件」的 agent 运行时：profile 是一叠有序的插件 bundle patch 层（`cordis.patch.yml`），
插件在 Host 进程内注册服务/工具，客户端插件通过 `window.__ModuleLoader__` 注入 React 组件与 slot。
本项目**只在 profile 层扩展**，不改签名应用与核心源码。

## 2. 组件

| 组件 | 类型 | 作用 | 代码 |
|---|---|---|---|
| `dsh-control-plane-session-tree` | vendored bundle + client | 替换 `sidebar.workspaces` 单槽：会话树、懒展开、工作区分组、搜索/排序/归档/置顶/重命名/Fork、六类头像 | `third_party/dsh-session-tree/` |
| `dsh-agent-teams-model-override` | 第三方 bundle（pinned） | 官方 Agent Teams 的薄扩展：`spawn_teammate_with_model`、嵌套 manager/worker、模型切换 | 外部依赖 |
| `dsh-workflow-map` | npm bundle | 会话步骤/工作流地图面板 | 外部依赖 |
| `dsh-local-telemetry` | npm bundle | 本地 SQLite 遥测（默认不采正文，可 export/purge） | 外部依赖 |
| `dshmarket` | npm bundle | 应用内插件市场（安装/升级/回滚 UX） | 外部依赖 |
| `delivery/` | 脚本 | 安装（快照+`dsh plugin add`+只读校验）/回滚/打包 | 本仓库 |
| `e2e/` | 测试 | 真机行为 E2E + 官方 mock 模型 + 失败取证 + CI | 本仓库 |

## 3. 安装与回滚

```
delivery/install.mjs
  ├─ profile 缺失 → dsh --profile <p> --from-default-profile web --dump-config
  ├─ 快照 package.json / cordis.patch.yml / pnpm-lock.yaml → $DSH_HOME/backups/control-plane/<p>/<ts>/
  ├─ dsh plugin --profile <p> add <specs...>          # CLI 自动登记 dsh.profile.bundles
  ├─ 只读校验：deps 存在 + bundles 已登记 + --dump-config 可见 row
  └─ 写 .control-plane-install.json 回执
delivery/uninstall.mjs
  └─ 按回执恢复快照 → dsh plugin install 清理依赖 → 校验 bundles 已移除
```

`desktop` profile 由 Electron 独占管理：CLI 写入需应用完全退出，或改用应用内 Plugins 页。

## 4. 客户端插件模型

- Host 半：`exports["."] → index.js`，只导出 `name` / `inject` / `apply`（无 `export default`）。
- Client 半：`exports["./client"] → client.js`，单文件 ESM，由 `window.__ModuleLoader__.load({ id, factory })` 注册。
- `dsh.bundle.patch` 指向 bundle 的 `cordis.patch.yml`（只 insert/disable row，row id 全局唯一）。
- `dsh.client.inject` 声明客户端依赖包；`dsh.client.platform = "web"`。
- 产物：`client.js` 由 `client.template.js` + `avatars/*.png`（data URL 内嵌）生成；`files` 只发运行时。

## 5. 测试分层

| 层 | 工具 | 覆盖 | 成本 |
|---|---|---|---|
| 静态 | `node --check`、`build.mjs --check`、manifest 契约测试 | 构建产物新鲜度、exports/files/locale/头像、engines | 0 |
| 真机 GUI（离线） | Playwright + 真实 DSH host | 外壳、侧栏树、头像、插件装载、工作流入口、视觉/键盘、交互韧性 | 0 |
| 真机 GUI（mock 模型） | 官方 `@deepseek-ai/dsh-llm-mock-server`（Messages 协议） | 发消息→确定性回复、遥测生命周期、长标题、故障边界（opt-in） | 0 |
| 真机 GUI（真实模型） | 用户登录 + `--real-model` | 真实回复/token、团队工具可见性、遥测落库 | 2 次调用/轮 |
| 安装/回滚 | `delivery/*.mjs` | 快照、bundle 登记、只读校验、回滚恢复 | 0 |

测试运行器 `e2e/run-e2e.mjs`：启动隔离 profile 的 DSH host → 解析 stdout 的带 token URL（只经 env 传递）
→ Playwright 子进程 → 关停/残留/端口审计 → 用户 home 哈希审计 → 截图与 `last-run.json`。

## 6. 隔离模型

- `DSH_E2E_HOME`（CI）或本机 `~/.dsh` 的独立 `e2e` profile；**绝不指向 `desktop`**。
- profile patch 把 sessions / storages / workspace / telemetry 全部重定向到 `$DSH_E2E_ROOT/state/**`。
- CI 用 npm 版 DSH（纯 Node、无 Electron）；桌面 Electron 壳在 macOS 本机验收。

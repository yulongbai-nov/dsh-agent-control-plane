# 真机行为 E2E（DSH 控制面）

用**真实安装的 DSH 0.2.1-rc.5 + 真实 Chromium + 真实登录**跑控制面的行为级端到端测试。
没有 mock GUI、没有假渲染；模型层默认零调用，`--real-model` 时才用真实账号花 2 次调用。

## 一条命令

```sh
cd e2e
npm install                    # 首次：安装 playwright 1.64.1（浏览器缓存已在 ~/Library/Caches/ms-playwright）
node run-e2e.mjs               # 离线套件（12 条，零模型请求）
node run-e2e.mjs --mock-model  # 追加确定性 mock 模型层（零成本，CI 用这个）
node run-e2e.mjs --real-model  # 追加 3 条真实模型/遥测用例（约 2 次模型调用）
node run-e2e.mjs --reset-state # 清空隔离状态后重跑
DSH_E2E_SELF_FAIL=1 node run-e2e.mjs  # 取证自检：故意失败一次，验证截图/视频/GIF/trace
```

运行器自动完成：缺失时从 `web` 模板创建 `e2e` profile → 注入隔离 patch →
用 `delivery/install.mjs` 安装控制面组件 → 启动 `dsh --profile e2e --host 127.0.0.1 --port 0 --no-open`
→ 解析带临时 token 的 URL（只经环境变量传递、不落盘）→ 跑 Playwright → 关停实例并校验端口/残留
→ 审计用户 `~/.dsh` 未被改动 → 截图与 `last-run.json` 落到 `/tmp/dsh-e2e/artifacts/`。

## 隔离模型

| 项 | 做法 |
|---|---|
| 凭据 | 共享 `~/.dsh/.credentials.yaml`（真实登录，真实模型） |
| profile | 独立 `e2e` profile，绝不指向 `desktop`（运行器显式拒绝） |
| 会话/存储/工作区/遥测 | profile patch 重定向到 `/tmp/dsh-e2e/state/**` |
| 用户 GUI（:50359） | 不连接、不重启、不修改 |
| 证据 | 每次运行前/后对 `workspace.json`、`.credentials.yaml`、`sessions/` 做哈希/列表对比 |

## 用例

| 文件 | 行为描述 |
|---|---|
| `01-shell` | 打开应用后侧栏出现会话树；点新建会话出现输入区；页面无未捕获异常 |
| `02-session-tree` | 工作区分组可折叠/展开；筛选框按标题过滤；行「⋯」菜单有置顶/重命名/Fork/归档 + 7 个头像项 |
| `03-avatars` | 每行渲染头像；手动指定「开发」后刷新仍保留；可恢复自动识别 |
| `04-plugins` | Plugins 页列出 5 个控制面插件；dshmarket 提供 Plugin Market 入口 |
| `05-workflow-map` | 侧栏「工作流地图」入口可打开且不崩溃，可回到会话 |
| `06-real-model` | 真实回复 + token 用量；`spawn_teammate_with_model` 对 agent 可见；遥测 SQLite 有真实事件行 |
| `07-mock-model` | 本地 OpenAI 兼容 mock provider 的确定性回复，且零真实模型调用（`--mock-model`） |
| `99-self-check` | 仅 `DSH_E2E_SELF_FAIL=1` 时故意失败，用于验证失败取证链路 |

## 证据

- 截图与 console 报告：`/tmp/dsh-e2e/artifacts/latest/`（每次运行覆盖）
- 汇总：`/tmp/dsh-e2e/artifacts/last-run.json`（启动耗时、端口、残留进程、隔离审计）
- 仓库内留存：`docs/evidence/2026-11-02/`

## 失败取证

失败用例自动留：`failure.png`、`failure.webm`、`failure.gif`、`trace.zip`、`error.txt`、`evidence.json`，
目录 `${DSH_E2E_ARTIFACTS}/failures/<runId>/<test-slug>/`；`DSH_E2E_SELF_FAIL=1` 可自检整条链路。
实现与 CI 上传见 `reporters/README.md` 与仓库 `docs/TEST-INFRA.md`。

## CI / 无头模式

GitHub Actions 用 npm 版 DSH（纯 Node，不依赖 Electron）跑同一套 mock E2E：见
`.github/workflows/e2e.yml`。本地模拟 CI：

```sh
DSH_E2E_HOME=/tmp/dsh-home DSH_E2E_ROOT=/tmp/dsh-e2e \
DSH_E2E_DSH_BIN=$(npm prefix -g)/bin/dsh node e2e/run-e2e.mjs --mock-model
```

（CI 里需要 `npm i -g @deepseek-ai/dsh@0.2.1-rc.5 pnpm@11.28.5`；profile 由 npm CLI 的 shipped template 自动创建。）

## 注意

- 同一 profile 同时只能有一个实例；运行器检测到残留会拒绝启动，需要 `pkill -f 'cli.js e2e'`。
- DSH 对 SIGTERM 可能不响应，运行器会 SIGKILL 并验证端口释放。
- 首次运行会看到 Preview Notice / Get started 弹窗，测试里用真实点击关闭。
- `--real-model` 消耗真实额度：本套件固定 2 次调用（回复 + 工具可见性），不要循环跑。

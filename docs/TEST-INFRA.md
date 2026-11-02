# 测试基建：mock 模型 / 录制回放 / CI / 失败取证

> 2026-11-02 落地版。目标：**真机 GUI 行为 E2E 可零成本、确定性、无头跑在 CI 上，失败自动留证据**。
> 结论先说：mock 模型层可以自己做（已跑通），官方也有一套更完整的测试包（建议下一步切换）；
> GitHub Actions 无头跑通已被本机实测（npm 版 DSH 纯 Node，不依赖 Electron）。

## 1. 三层模型策略

| 层 | 用什么 | 覆盖 | 成本 | 何时跑 |
|---|---|---|---|---|
| 无模型层 | 纯 GUI/Host（不触发模型） | 侧栏树、头像、插件加载、工作流入口、安装/回滚 | 0 | 每次提交 |
| **mock 模型层** | **官方 Messages mock**（`@deepseek-ai/dsh-llm-mock-server`，唯一实现，覆盖生产协议） | 发消息→确定性回复、标题、tool 可见性、故障注入 | 0 | 每次提交 / CI |
| 真实模型层 | 用户真实登录（`--real-model`） | 真实回复、真实 token/缓存、最终验收 | 2 次调用/轮 | 手动 / nightly |

## 2. mock 模型层（官方 Messages mock 为默认，已接入并验证）

### 2.1 官方 `@deepseek-ai/dsh-llm-mock-server`（默认，`--mock-model`）

- 接入方式：`e2e/mock-provider/official-server.mjs` 调 `startMockLlmServer()`，打印
  `MOCK_PROVIDER_URL`；`run-e2e.mjs` 把它通过 **`$DEEPSEEK_BASE_URL`** 交给真实 DeepSeek adapter，
  并设 `DEEPSEEK_API_KEY=mock-key`（mock 不校验 key）。**走生产 Messages 协议**，无需改 profile。
- 实测：GUI 里模型仍显示生产路由 `DeepSeek-V4.1-Flash`，回复来自 mock（`MOCK_OK:official mock provider`），
  `Usage 33 tok`，零真实调用；本地与 CI 模式均通过（2026-11-02 全量：`--mock-model` 22 passed / 6 skipped，
  默认 20 passed / 8 skipped，`--real-model` 24 passed / 4 skipped）。
- 能力：官方 mock 支持 24 种行为（429/500/stall/断流/坏 chunk/`tool_call_success`…）、请求捕获、
  随机故障压测（种子可复现）。下一步可用 `tool_call_success` 确定性地驱动 workflow / 团队工具，
  做 R10/R11/R4/R6 的零模型 E2E。

## 3. 官方测试基建（可直接复用，已发布到 npm）

上游 `deepseek-ai/deepseek-harness` 的 `packages/test-support/`，rc.5 版本已发布：

| 包 | 版本 | 用途 |
|---|---|---|
| `@deepseek-ai/dsh-llm-mock-server` | 0.2.1-rc.5 | **真 HTTP mock 模型服务**：Messages `/v1/messages`、24 种故障（429/500/503/stall/断流/坏 chunk/partial EOF/tool_call…）、捕获请求 |
| `@deepseek-ai/dsh-llm-replay` | 0.2.1-rc.5 | 录制/回放 provider 流量 |
| `@deepseek-ai/dsh-session-snapshot` | 0.2.1-rc.5 | 会话快照断言 |
| `@deepseek-ai/dsh-loader-smoke` | 0.2.1-rc.5 | 插件装载冒烟 |
| `@deepseek-ai/dsh-agent-loop-testkit` | 0.2.1-rc.5 | Agent 循环测试工具 |
| `@deepseek-ai/dsh-client-test-runtime` | 0.2.1-rc.5 | jsdom 客户端测试运行时（生产 SlotRegistry/渲染器 + 测试替身） |
| `@deepseek-ai/dsh-remote-mock` | 0.2.1-rc.5 | Remote mock |

另有上游 `vitest.e2e / vitest.expected / vitest.snapshot / vitest.web` 四套配置、`docs/testing.md`、
`apps/web/tests`（含 `agent-team-panel.e2e.ts`）可照抄结构。

**已落地（2026-11-02）**：E2E 的唯一 mock 层是官方 `llm-mock-server`（Messages 协议 + 请求捕获）；
已删除自写 mock，保持与官方一致、避免多套实现。

## 4. 录制回放（两条路）

| 方式 | 粒度 | 适用 |
|---|---|---|
| 本仓库 mock provider `--record/--replay` | 单次模型请求（hash 匹配） | 快速回归、离线复现、CI |
| 官方 `llm-replay` + `session-snapshot` | provider 流量 / 会话快照 | 真实流量回放、跨版本行为对比 |

实践原则：真实模型跑一轮 → 录制 → CI 回放；**录制文件不得含密钥/Authorization**（我们的实现已验证不写）；
回放命不中时显式失败，不静默调用真实模型。

## 5. 现成库评估（为什么不用通用拦截库）

| 库 | 结论 |
|---|---|
| `msw` | 同进程 Service Worker/拦截，跨进程宿主不适用 |
| `nock` | 只拦 http 模块，拦不到原生 `fetch`；宿主是独立进程 |
| `polly.js` | 同进程拦截，2023 年后停更 |
| `node-vcr` | 同进程；维护弱 |
| WireMock | 可行但需要 JVM，重 |
| **官方 llm-mock-server** | 真 HTTP、协议匹配、故障注入全 → **首选** |
| **自写 `node:http` mock（本项目）** | 无依赖、协议可自定义、~200 行 → 轻量场景首选 |

## 6. GitHub Actions 无头 E2E

**可行性已实测（2026-11-02，本机 macOS + npm CLI，非 Linux）**：

- npm `@deepseek-ai/dsh@0.2.1-rc.5` 的 bin 是 `lib/bin.js`（`#!/usr/bin/env node`），依赖里**没有 Electron**；
  前端 `@deepseek-ai/dsh-web-frontend` 已预编译，安装即用。
- `dsh --profile e2e --from-default-profile web --dump-config` 能创建 profile；
  `dsh --profile e2e --host 127.0.0.1 --port 0 --no-open` 能启动真实 Web UI 并打印带 token 的 URL。
- 用 `DSH_E2E_HOME=<隔离目录>` + npm CLI 跑完整套件：**12 passed / 4 skipped**，隔离审计通过、零残留进程。
- 安装插件需要 `pnpm` 在 PATH（`dsh plugin` 会转发 pnpm）；CI 里 `npm i -g pnpm@11.28.5` 即可。

工作流：`.github/workflows/e2e.yml`（文件名保留，内容是最小 smoke，**手动触发**）。

- 最小 job：ubuntu-latest + Node 24 + `@deepseek-ai/dsh@0.2.1-rc.5` + `pnpm@11.28.5`
  + `playwright install --with-deps chromium`（headless 不需要 xvfb）+ `node e2e/run-e2e.mjs --mock-model`。
- 失败证据（截图/视频/GIF/trace/隔离报告）用 `actions/upload-artifact` 上传，保留 14 天。
- 真实模型冒烟是 `workflow_dispatch` 的可选输入，需要 `DEEPSEEK_API_KEY` secret，默认不跑。
- 升级路径：取消 `push/pull_request` 注释 + 把 job 设为 branch protection required check。

**限制**：Linux runner 只能覆盖 core + Web GUI；签名 Electron 桌面外壳无法在 Linux 跑。
若必须验收桌面壳，用 self-hosted macOS runner（本机已有安装版）跑同一命令。
真实模型不进 PR CI：需要 secret 且产生费用；建议放 nightly 手动触发。

## 7. 失败自动取证（截图 / 视频 / GIF / trace）

- `e2e/playwright.config.mjs`：`screenshot: 'only-on-failure'`、`video: 'retain-on-failure'`、
  `trace: 'retain-on-failure'`，并注册 `./reporters/failure-evidence.mjs`。
- reporter 把失败证据归档到：
  `${DSH_E2E_ARTIFACTS}/failures/<runId>/<test-slug>/`
  含 `failure.png`、`failure.webm`、`failure.gif`、`trace.zip`、`error.txt`、`evidence.json`、`index.json`。
- GIF 链路：Playwright 自带 ffmpeg 是精简构建（无 GIF encoder/palette 滤镜）→ 用 ffmpeg 抽帧 +
  `gifenc` 合成；找不到 ffmpeg 时记录"gif 不可用"并保留 webm，绝不因取证失败影响测试结果。
- 自检：`DSH_E2E_SELF_FAIL=1 node e2e/run-e2e.mjs` 会跑一条故意失败的用例并在结束后收集证据。
  实测产出：`failure.png` (1440×900)、`failure.webm` (67 KB)、`failure.gif` (480×300, 42 帧, 327 KB)、
  `trace.zip` (~1 MB)。

## 8. 命令速查

```sh
# 离线真实 GUI（零模型调用）
node e2e/run-e2e.mjs
# 确定性 mock 模型（官方 Messages mock，零成本，CI 用这个）
node e2e/run-e2e.mjs --mock-model
# 真实模型验收（2 次调用）
node e2e/run-e2e.mjs --real-model
# 失败取证自检
DSH_E2E_SELF_FAIL=1 node e2e/run-e2e.mjs
# 纯 Node 无头 CI 模式（不依赖桌面 app）
DSH_E2E_HOME=/tmp/dsh-home DSH_E2E_ROOT=/tmp/dsh-e2e \
DSH_E2E_DSH_BIN=$(npm prefix -g)/bin/dsh node e2e/run-e2e.mjs --mock-model
```

## 9. 下一步

1. ~~接入官方 `llm-mock-server`~~ ✅ 已完成（默认层；`--mock-model`）。
2. 用官方 mock 的 `tool_call_success`（`toolName`/`toolArguments`）确定性驱动 `workflow` 与
   `spawn_teammate_with_model`，做 R10/R11/R4/R6 的零模型 E2E。
3. 真实流量录制 → 回放进 CI，替代部分真实模型验收。
4. nightly：self-hosted macOS runner 跑 `--real-model` 桌面壳验收。
5. 失败证据进 PR 评论（下载链接），并把 `failure.gif` 自动附到 issue。

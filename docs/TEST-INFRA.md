# 测试基建：mock 模型 / 录制回放 / CI / 失败取证

> 2026-11-02 落地版。目标：**真机 GUI 行为 E2E 可零成本、确定性、无头跑在 CI 上，失败自动留证据**。
> 结论先说：mock 模型层可以自己做（已跑通），官方也有一套更完整的测试包（建议下一步切换）；
> GitHub Actions 无头跑通已被本机实测（npm 版 DSH 纯 Node，不依赖 Electron）。

## 1. 三层模型策略

| 层 | 用什么 | 覆盖 | 成本 | 何时跑 |
|---|---|---|---|---|
| 无模型层 | 纯 GUI/Host（不触发模型） | 侧栏树、头像、插件加载、工作流入口、安装/回滚 | 0 | 每次提交 |
| **mock 模型层** | 本地 OpenAI 兼容 mock provider（`e2e/mock-provider`） | 发消息→确定性回复、标题、tool 可见性、错误注入 | 0 | 每次提交 / CI |
| 真实模型层 | 用户真实登录（`--real-model`） | 真实回复、真实 token/缓存、最终验收 | 2 次调用/轮 | 手动 / nightly |

## 2. 本地 mock provider（已实现并验证）

实现：`e2e/mock-provider/server.mjs`（`node:http`，一个文件，无依赖）。

- 协议：OpenAI Chat Completions（`/v1/models`、`/v1/chat/completions`，支持 SSE 流式）。
  通过 profile 的 `llm-pi-ai` 路由接入：`api: openai-completions` + `baseURL: http://127.0.0.1:<port>/v1`。
  `apiKeyEnv: E2E_MOCK_KEY`，值由 `run-e2e.mjs` 注入进程环境——**不需要真实凭据，也不读用户密钥**。
- 场景标记（写在 prompt 里即可选故障）：
  `[[MOCK_ERROR_429]]`、`[[MOCK_ERROR_500]]`、`[[MOCK_TIMEOUT]]`、`[[MOCK_STOP]]`；
  普通 prompt → `MOCK_OK:<echo>`；包含 `1+1` → `2`。
- 录制：`--record <file.jsonl>`，每条记录 `{at, hash, model, scenario, prompt, response}`；
  `hash = sha256(model + messages + tool names)`，**永不记录 Authorization**。
- 回放：`--replay <file.jsonl>`，请求 hash 命中即回放录制响应，可脱离真实 provider 复现。
- 自测：`node e2e/mock-provider/self-test.mjs` 覆盖模型列表、非流式、SSE、429/500 注入、录制、回放——8 项 PASS。
- 真实 GUI 验证：`node e2e/run-e2e.mjs --mock-model` → 12 passed / 4 skipped；模型显示 `mock-echo`，
  mock provider 记录到真实请求（零真实调用）。见 `docs/evidence` 的 `13-mock-model-reply.png`。

**边界（写清楚，避免误读）**：这是 OpenAI-completions 协议，走 pi-ai 自定义路由；
DSH 默认的 DeepSeek adapter 用的是 **Messages 协议（`/v1/messages`）**，本 mock 不覆盖该协议。
要覆盖默认 adapter，用下面的官方 `llm-mock-server`。

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

**建议路线**：把 E2E 的 mock 层切到官方 `llm-mock-server`（更接近生产协议、故障种类全、带请求捕获），
我们的 OpenAI mock 保留给"pi-ai 自定义路由 / 轻量 CI / 不需要 Messages 协议"的场景。

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

工作流：`.github/workflows/e2e.yml`

- `e2e-mock` job：ubuntu-latest + Node 24 + `@deepseek-ai/dsh@0.2.1-rc.5` + `pnpm@11.28.5`
  + `playwright install --with-deps chromium`（headless 不需要 xvfb）+ `node e2e/run-e2e.mjs --mock-model`。
- 失败证据（截图/视频/GIF/trace/隔离报告）用 `actions/upload-artifact` 上传，保留 14 天。
- `pack` job：`node delivery/pack.mjs`，把 `dist/` 作为 artifact（可发布/归档）。

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
# 确定性 mock 模型（零成本，CI 用这个）
node e2e/run-e2e.mjs --mock-model
# 真实模型验收（2 次调用）
node e2e/run-e2e.mjs --real-model
# 失败取证自检
DSH_E2E_SELF_FAIL=1 node e2e/run-e2e.mjs
# mock provider HTTP 自测（含录制/回放/故障注入）
node e2e/mock-provider/self-test.mjs
# 纯 Node 无头 CI 模式（不依赖桌面 app）
DSH_E2E_HOME=/tmp/dsh-home DSH_E2E_ROOT=/tmp/dsh-e2e \
DSH_E2E_DSH_BIN=$(npm prefix -g)/bin/dsh node e2e/run-e2e.mjs --mock-model
```

## 9. 下一步

1. 接入官方 `llm-mock-server` 覆盖默认 Messages 协议 + 24 种故障，替换/补充现有 OpenAI mock。
2. mock provider 增加脚本化工具调用（`workflow` / `spawn_teammate_with_model`），用于 workflow 与团队确定性 E2E。
3. 真实流量录制 → 回放进 CI，替代部分真实模型验收。
4. nightly：self-hosted macOS runner 跑 `--real-model` 桌面壳验收。
5. 失败证据进 PR 评论（下载链接），并把 `failure.gif` 自动附到 issue。

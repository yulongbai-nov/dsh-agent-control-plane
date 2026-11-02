# 官方 DSH CI 与插件约定（对照本仓库）

> 调研对象：上游 `deepseek-ai/deepseek-harness` **commit `b830ec950faba0a46dda564be3e2d854afed94f1`**（2026-10-29，`release-dsh-0.2.1-rc.5` 合并，MIT）。
> 本文件只做对照与建议：不修改代码/配置；所有外链固定在上述 commit，外部项目链接指向其默认分支。
> 已有调研见 [`docs/TEST-INFRA.md`](./TEST-INFRA.md)（mock/回放/取证落地细节），本文件补齐「官方 CI 组织」「同类项目做法」「官方插件包约定」。

---

## 0. TL;DR

1. **官方 CI 是“PR 最小门禁 + master 全量/串行兜底 + 真 API e2e 独立 workflow + 桌面打包独立 workflow”的四层结构**：PR 只有 `ci.yml`（静态/覆盖率/基准/构建尾部/Node 兼容矩阵/Windows 观测），真模型 e2e 在 `e2e.yml`（需要 key），桌面安装包在 `windows-package.yml` / `macos-package.yml` / `desktop-publish.yml`（macOS 用自托管 runner）。
2. **E2E 的官方姿势**：`node-24-consumers` job 装 Playwright（Chromium+WebKit）＋构建产物 → `check:ci:consumers` 跑 snapshot/artifact gates；Web 浏览器 lane 在**进程内** boot 真实 web composition（真 HTTP）再用真 Chromium 驱动，WebKit 只覆盖少数焦点场景；golden 对比、失败截图本地留存，不统一上传 artifact。
3. **同类项目可复用的模式**：固定 Playwright 容器镜像或版本（HA）、shard + blob report 合并 + PR 评论（HA）、失败才传截图/trace（VS Code、Cline）、path filter 跳过昂贵 job（Cline）、`build once → artifact 分发`（HA/VS Code/Continue）、Linux 用 xvfb 仅限 headed/Electron（VS Code/Cline），纯 headless Chromium 不需要。
4. **官方插件包约定**：bundle 由 `dsh.bundle.patch` 声明 patch 层（`cordis.patch.yml` 只 insert/disable row），profile 只由 `dsh --profile` / `dsh plugin` 维护；客户端插件额外 `exports["./client"]` + `dsh.client.platform/inject`；包内 `tests/`、`src/types.ts` 只放类型、`files` 只发运行时产物；DSH 在**安装前**按 `engines.dsh` 或 `@deepseek-ai/dsh*` peer 区间做兼容性拒绝（可写 `compatibility.json` 做 exact 版本豁免）。
5. **我们仓库最该改的 3 件事**：发布包 `files` 只留运行物并补 `tests/`；删掉/核实非官方 `dsh` 字段（`manifestVersion`、`client.immediately`）并明确 `engines.dsh`/peer 策略；`delivery/install.mjs` 不再手改 `dsh.profile.bundles`、不再复制 web profile。

---

## 1. 官方 DSH 仓库怎么组织 CI/测试

### 1.1 证据面

| 证据 | 链接（固定 commit） |
|---|---|
| 工作流目录（25 个 workflow） | [`/.github/workflows`](https://github.com/deepseek-ai/deepseek-harness/tree/b830ec950faba0a46dda564be3e2d854afed94f1/.github/workflows) |
| 测试政策 | [`docs/testing.md`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/testing.md) |
| 开发指南（构建/类型组织） | [`docs/development.md`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/development.md) |
| 根 scripts | [`package.json`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/package.json) |
| vitest 配置 | [`vitest.config.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/vitest.config.ts) / [`vitest.e2e.config.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/vitest.e2e.config.ts) / [`vitest.expected.config.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/vitest.expected.config.ts) / [`vitest.snapshot.config.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/vitest.snapshot.config.ts) / [`vitest.web.config.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/vitest.web.config.ts) |
| 包规则 | [`packages/AGENTS.md`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/AGENTS.md) |
| 新增包清单 | [`docs/cookbook/adding-a-package.md`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/cookbook/adding-a-package.md) |

### 1.2 工作流总表（按用途）

| workflow | 触发 | 用途 | 关键 runner |
|---|---|---|---|
| `ci.yml` | `pull_request` | PR 主门禁（静态/覆盖率/基准/构建尾部/Node 兼容/Windows 观测） | hosted `ubuntu-latest`/`ubuntu-24.04`，可切 Blacksmith/自托管 |
| `ci-master.yml` | `push master` | master 全量 + 串行兜底/演练 + macOS/Windows 自托管 lane + 大 runner 基准 | `ubuntu-latest`、`[self-hosted, linux, x64, vm-backup]`、`macos-latest`、`[self-hosted, dsh-win-ci, windows]` |
| `e2e.yml` | push/PR/dispatch/cron | **真 DeepSeek API** e2e（需 key，keyless 会 self-skip，故有 preflight 防假绿） | `ubuntu-latest` 或 Blacksmith |
| `expected-filenames.yml` | PR（限定 paths） | 禁止 golden 文件名 | `ubuntu-latest` |
| `pi-ai-provider-e2e.yml` | 独立 | pi-ai provider e2e | — |
| `sandbox.yml` / `node-addon-system.yml` | 独立 | 沙箱、原生 addon | — |
| `windows-package.yml` / `macos-package.yml` | dispatch | 桌面安装包构建 | `dsh-win-package-trial`、`[self-hosted, macOS, ARM64, dsh-mac-package-trial]` |
| `desktop-publish.yml` | dispatch/release | 桌面发布（按 route 选自托管 runner） | `[self-hosted, '<runner>']` |
| `release.yml` / `python-release.yml` 等 | tag/dispatch | npm tarball、Python 发布 | `ubuntu-latest`/自托管 |
| `pr-check-*.yml` / `weighted-approval*.yml` | PR 事件 | 审批/分支流程治理 | `ubuntu-latest` |

### 1.3 `ci.yml` 的 job 拆分（PR 门禁）

| job | 名称 | 内容 | runner |
|---|---|---|---|
| `node-24` | node 24 / static | lint、publint、类型、约束等静态门禁（`check:ci:static`） | 可切换 hosted/Blacksmith/自托管 |
| `node-24-coverage` | node 24 / coverage | 分区覆盖率 + 时长历史缓存 + `DSH_COVERAGE_*` | 同上 |
| `node-24-bench` | node 24 / benchmarks | 构建 + Playwright Chromium + 性能基准 + `benchmark-report` artifact | `ubuntu-24.04` |
| `node-24-consumers` | node 24 / snapshots and artifacts | 装 Playwright（Chromium+WebKit）→ 构建 Office runtime → `check:ci:consumers`（兼容/快照/构建产物尾部） | 可切换 |
| `node-compat` | `${{ matrix.name }}` | Node **22.19 / 24.9 / 26** 三版本兼容 smoke（`max-parallel: 1`，fail-fast false） | `ubuntu-latest` 等 |
| `python-sdk` / `python-runtime` | — | keyless Python SDK 测试 / release 形状矩阵 | `ubuntu-latest` |
| `windows-build` / `windows-coverage` / `windows-native-tests` | windows node 24 / … | Windows 构建、观测门禁、覆盖率、原生测试 | Windows 自托管/`windows-latest` |
| `all-checks-passed` | all checks passed | **聚合 job**：`needs:` 所有必需 job，任一 `failure/cancelled/skipped` 即失败 | 与 Linux worker 同一 selector |

> 设计要点：`ci.yml` 注释明确“三个 enterprise job 互相独立进入 runner 分配”，`all-checks-passed` 只做 bookkeeping 判决，**防止 skipped 被当成绿色**。

### 1.4 runner / 矩阵 / 容灾

- **Linux 可切换池**：`DSH_CI_FAILOVER_LINUX` 变量选择 Blacksmith（`blacksmith-8vcpu-ubuntu-2404` / 16vcpu）或自托管 `[self-hosted, linux, x64, vm-backup]`，未设置时用 hosted enterprise pool。
- **Windows 单独开关**：`DSH_CI_FAILOVER_WINDOWS`。
- **自托管兜底**：每个 master push 都跑 `serial-linux-selfhosted`（`DSH_*_MAX_WORKERS: '1'`、`DSH_GATE_CONCURRENCY: '1'`）作为 failover 演练；`serial-macos` 当前 `if: false`，`serial-windows` 用自托管 Windows。
- **Node 兼容矩阵**：`22.19`、`24.9`、`26` 串行跑；`24.9` 的注释解释了为什么不写裸 `24`（24.0–24.11.1 内部 loader v1、最新 24 是 v2）。
- **机器规格**：大 runner 用于基准（4/8/16/32/64/96 core 档），普通门禁用 8–16 vcpu。

### 1.5 缓存策略

| 缓存 | 做法 | 键/位置 | 备注 |
|---|---|---|---|
| pnpm store | `actions/cache/restore`，hosted 只 restore；自托管用持久 store | `${runner.os}-node-${PRIMARY_NODE_VERSION}-pnpm-${hashFiles('pnpm-lock.yaml')}` + `restore-keys` | hosted 不在 master 保存，避免污染缓存命名空间 |
| 覆盖率时长历史 | `actions/cache/restore` + `save` | `coverage-times-${OS}-${runner.environment}-...-${run_id}-${run_attempt}` | 用于按历史时长分区 |
| Playwright 浏览器 | `actions/cache/restore` | `${runner.os}-playwright-${hashFiles('pnpm-lock.yaml')}`，路径 `PLAYWRIGHT_BROWSERS_PATH` | 自托管保留浏览器缓存；hosted 才下载 |
| Node 编译缓存 | 重定向到 `runner.temp` | `NODE_COMPILE_CACHE=${{ runner.temp }}/node-compile-cache` | 避免写根分区 `/tmp` |
| setup-node 包缓存 | `cache: pnpm`（e2e）/ `package-manager-cache: false`（release） | 由 action 管理 | e2e 与 release 选择性使用 |

### 1.6 flaky / 失败处理

| 机制 | 证据 |
|---|---|
| PR 并发取消 | `concurrency: group: ${{ github.workflow }}-${{ github.ref }}` + `cancel-in-progress: true` |
| 门禁 fail-fast | `DSH_GATE_FAIL_FAST: '1'`（串行/兼容矩阵等 lane） |
| 串行兜底 | `serial-*` lane 全部 `DSH_*_MAX_WORKERS=1`/`DSH_GATE_CONCURRENCY=1` |
| 真 API e2e 重试 | `vitest.e2e.config.ts`: `retry: 2`、`testTimeout 120s`、`DSH_E2E_MAX_WORKERS` 限并发 |
| keyless 假绿防护 | `e2e.yml`：keyless 套件 self-skip，所以 trusted 事件里 **preflight 必须存在 key**，否则硬失败 |
| 只读快照 | `test:web` 在 Linux CI 固定 `DSH_SNAPSHOT=replay`；record/refresh 只本地跑 |
| Windows 观测门禁 | `windows-build` 里 observational 失败只报告（`Report Windows observational failures`），阻塞子集单独定义 |
| 聚合判决 | `all-checks-passed` 对 `needs.*.result` 里 failure/cancelled/skipped 一律失败 |
| OS 差异留白 | macOS serial lane 暂时 `if: false`（TODO 恢复），说明官方也不把“全平台同时绿”当 PR 前提 |

### 1.7 E2E 怎么起 Web / Playwright

官方没有“起一个 `dsh web` 进程再用浏览器点”的 PR 门禁，而是两条路：

1. **进程内真 Web 组装 + 真浏览器（PR 门禁，keyless）**
   - 文件：`apps/web/tests/*.e2e.ts`（如 [`agent-team-panel.e2e.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/apps/web/tests/agent-team-panel.e2e.ts)）与 [`apps/web/tests/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/apps/web/tests/README.md)。
   - 机制：`launchWebScaffold()` 在测试进程内 boot 真实 web composition（真 HTTP），`chromium.launch()` 驱动真浏览器；WebKit 只用于 picker 焦点、reload 等少量场景。
   - runner：`test:web:ci = tsx scripts/run-web-snapshots.ts`；脚本先串行跑 browser owners，再受 `DSH_WEB_SNAPSHOT_WORKERS` 限制跑快照池。
   - golden：`compareOrRefreshGolden`；失败截图 `saveFailureShot`，golden 差异随日志/本地输出，不单独上传 artifact。
   - 该 lane 属于 Host 面测试（读 `ctx.connection`/SessionStore），**不要 import `@deepseek-ai/dsh-client-*`**（会污染 Host 构建图）——见其 README。
2. **keyless 组装后的 CLI/进程期望（PR 门禁）**
   - `vitest.expected.config.ts` + `apps/cli/tests/**/*.expected.e2e.ts`：`web-failure-matrix`、`web-browser-open`、`plugin-compatibility`、`dump-config-schema`、`built-bin` 等；跑**已构建**产物，验证真实入口。
3. **真模型 e2e（独立 workflow）**
   - `e2e.yml`：`ubuntu-latest`/Blacksmith，Node 24，45 分钟超时；preflight 要求 `DEEPSEEK_API_KEY`；`DSH_EXAMPLE_MODE=lib` 跑构建后的 bin；`DEEPSEEK_BASE_URL` 显式钉到外部 API；`DSH_E2E_MAX_WORKERS=4`；先用 `build:official` 构建并准备 Linux Office runtime。

Playwright 安装：`pnpm --filter @deepseek-ai/dsh-web-frontend exec playwright install --with-deps chromium webkit`（hosted）；自托管 VM 只装浏览器二进制（系统依赖由镜像维护）。`PLAYWRIGHT_BROWSERS_PATH` 指向 `RUNNER_TEMP`。

### 1.8 测试产物上传

| workflow | artifact | 内容/保留 |
|---|---|---|
| `ci.yml`（bench） | `benchmark-report` | `benchmarks/.dsh-report/`，`!cancelled()`，7 天 |
| `windows-package.yml` | `windows-package-logs-*`、`windows-x64-unsigned/signed-*` | 打包日志 + 安装包，14 天 |
| `macos-package.yml` | `macos-package-logs-*`、`macos-arm64-*` | 同上，14 天 |
| `desktop-publish.yml` | `desktop-publication-*` | 发布记录，30 天 |
| `release.yml` | `dsh-npm-tarballs` | npm tarball，7 天 |
| `apps/web/tests` | 无单独上传 | 失败截图/console 在测试输出；golden 在仓库 |

> 注意：官方 PR 门禁里**没有**统一上传 Playwright 报告/截图；这依赖测试内建证据与失败日志。对我们这种“失败必须可取证”的项目，参考 VS Code/HA 的 artifact 模式更合适（见 §2）。

---

## 2. 同类项目的 CI 做法

样本：**VS Code**（Electron 桌面 + Web + 扩展生态）、**Home Assistant Frontend**（Web UI + 真浏览器 E2E）、**Cline**（VS Code 扩展 + Webview + 桌面应用）、**Continue**（IDE 扩展 + GUI）、**Obsidian Sample Plugin**（插件模板基线）。

### 2.1 各项目要点

| 项目 | 关键 workflow | 做法 | 可复用点 |
|---|---|---|---|
| **microsoft/vscode** | [`pr-linux-test.yml`](https://github.com/microsoft/vscode/blob/main/.github/workflows/pr-linux-test.yml)、`pr-darwin-test.yml`、`pr-win32-test.yml`、[`sessions-e2e.yml`](https://github.com/microsoft/vscode/blob/main/.github/workflows/sessions-e2e.yml)、`pr.yml`（轻量 PR） | 大自托管 runner（`vscode-large-runners-ubuntu-8-core`）；xvfb 作为服务启动；node_modules/内置扩展缓存；Playwright Chromium 安装带重试循环；`--rerun-failed-files 2`；Electron smoke 分 3 shard；**失败才上传** crash dump / node_modules / logs（`if: failure()`） | Electron 桌面用 xvfb + 分片 + 失败工件；PR 快慢分层；OS 专属 job |
| **home-assistant/frontend** | [`e2e.yaml`](https://github.com/home-assistant/frontend/blob/dev/.github/workflows/e2e.yaml)、[`ci.yaml`](https://github.com/home-assistant/frontend/blob/dev/.github/workflows/ci.yaml) | 官方 **Playwright docker 镜像**（`mcr.microsoft.com/playwright:v1.64.1-noble`，pin 版本）；`build-demo/app/gallery` 一次构建 → artifact 分发给测试 job；E2E 按 2/4 shard 矩阵；每 shard `upload-artifact` blob report（`if: always()`）；`report` job 合并 Playwright blob report → 上传合并 HTML → **PR 评论**；CI 有 lint/test/build、bundle size 预算 | Playwright 容器镜像、build once + artifact、shard + blob 合并、PR 报告评论、体积预算 |
| **cline/cline** | [`ext-vscode-test-e2e.yml`](https://github.com/cline/cline/blob/main/.github/workflows/ext-vscode-test-e2e.yml)、[`desktop-test.yml`](https://github.com/cline/cline/blob/main/.github/workflows/desktop-test.yml) | e2e 矩阵 `ubuntu/windows/macos`（`*-latest`）；`dorny/paths-filter` 变更检测跳过昂贵 job；Linux 才装 xvfb 且 `xvfb-run`；缓存 VS Code 安装目录（精确 key）；**失败才上传** `playwright-recordings-${runner}` | 跨 OS 矩阵（真 Electron/VS Code 测试必须 macOS/Windows）、path filter、失败录像 |
| **continuedev/continue** | [`pr-checks.yaml`](https://github.com/continuedev/continue/blob/main/.github/workflows/pr-checks.yaml)、`auto-fix-failed-tests.yml` | 多 job：prettier/core/gui/binary/vscode/`packages` 动态矩阵/vscode 按测试文件矩阵；npm/node_modules 多层缓存；上传扩展构建 artifact；`auto-fix-failed-tests` 存在但 `if: false && …` **被禁用** | “按包/按测试文件矩阵”；自动修复不是默认能力（谨慎） |
| **obsidianmd/obsidian-sample-plugin** | [`lint.yml`](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/.github/workflows/lint.yml)、[`release.yml`](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/.github/workflows/release.yml) | 仅 lint（Node 20/22/24 矩阵）+ tag 触发 release（build、`actions/attest` 构建来源、`gh release create --draft`） | 插件模板基线：**没有测试/E2E**；插件生态项目常见“lint+release”即止，我们要比模板多走 e2e |

### 2.2 提炼出的可复用模式

| 模式 | 为什么 | 我们的用法 |
|---|---|---|
| 固定 Linux 版本（`ubuntu-24.04`/容器镜像） | 避免 `-latest` 漂移、系统依赖不一致 | 我们的 CI 用 `ubuntu-24.04`，Playwright 版本在 `e2e/package.json` 固定 |
| headless Chromium，无需 xvfb | 纯浏览器渲染不依赖 X | 我们的 Web GUI e2e 直接 headless；只有 Electron 才需要 xvfb/macOS |
| Playwright 容器镜像或版本 pin | 浏览器 + 系统依赖一致 | 可选用官方镜像；当前用 `playwright install --with-deps` |
| build once → artifact 分发 | 多 shard/多 job 不重复构建 | Web 前端/产物可在 `pack` job 构建后分发 |
| shard + blob report 合并 | 浏览器套件>10 分钟后线性变慢 | 现在 12 条用例不需要；增长后照 HA |
| 失败才上传（截图/video/trace/logs）| 省存储、证据在失败处 | 我们已实现 `failure-evidence`；建议 `if: failure()` + `always()` 上传 run 摘要 |
| PR 报告评论 | 评审不用翻日志 | 可选，等 shard 化后再加 |
| path filter / 变更检测 | 文档类 PR 不跑 e2e | 我们的 e2e 可加 `paths:`（`third_party/**`、`e2e/**`、`delivery/**`、`.github/workflows/e2e.yml`） |
| 聚合 `all-checks-passed` | 分支保护只认一个必过项 | 官方同款，我们缺 |
| 真模型单独 lane（nightly/manual + secret preflight） | 花费/密钥隔离 | 我们用 `--real-model` + `workflow_dispatch` |
| macOS/Windows 自托管 | Electron 桌面壳只能真机 | 桌面验收留 macOS（本机脚本或未来自托管 runner） |
| auto-fix 慎用 | Continue 自己都默认关闭 | 不引入 |

### 2.3 对本仓库场景的建议

**不可改变的事实**：签名 Electron 桌面壳不能在 Linux runner 跑（`@deepseek-ai/dsh-desktop-host` 不在 npm，桌面 profile 由 Electron 独占管理）；Linux CI 只能覆盖 **core + Web GUI + 插件 bundle 装配**。因此：

- **PR 必跑（Linux）**：静态/构建新鲜度、单元测试（绿子集）、mock e2e（真 Web GUI + Chromium + 官方 Messages mock）、打包与安装契约检查。目标 <10 分钟。
- **master/nightly（Linux）**：更深的 e2e（工作流/团队/遥测场景、错误注入、重连/重启）、真实模型 2 次调用（secret + preflight）、可选 Node 22.26 兼容 smoke。
- **桌面壳（macOS）**：保留 `node e2e/run-e2e.mjs --mock-model` 的本机真机验收；未来可接自托管 macOS runner（`[self-hosted, macOS]`）或 GitHub `macos-latest`（可运行未签名 Electron，但安装桌面 app/签名/更新链路仍需真机）。在 Linux workflow 中对桌面用例显式标 `NOT_APPLICABLE`，不要静默跳过。
- **产物策略**：失败必传 evidence（截图/GIF/trace/error）；成功只传摘要（run 时间、端口、隔离审计）；保留 7–14 天。
- **节流**：PR 只跑最小集；e2e 加 path filter；concurrency cancel；master 跑全量。

---

## 3. 官方 plugin 组织方式

### 3.1 包分层与目录

| 层 | 目录 | 例 | 说明 |
|---|---|---|---|
| profile bundle | `packages/bundle/*` | `base`、`web-app`、`headless`、`acp-app`、`sdk-app`、`sdk-minimal` | 只贡献 profile patch 层，被 `dsh.profile.bundles` 引用 |
| 实验 bundle/profile | `packages/experimental/*` | `agent-team-profile`、`session-titles-bundle`、`plugin-market-bundle` | 命名 `dsh-experimental-*`；可 `disabled: true` 官方行后 insert |
| 客户端 UI 插件 | `packages/client/ui-*` | `ui-plugin-manager`、`client-ui-agent-team` | 有 `exports["./client"]` + `dsh.client` |
| Host 能力/插件 | `packages/<group>/*` | `llm/*`、`session/*`、`boot/*` | service 包 default export；function plugin named export |
| 测试基建 | `packages/test-support/*` | `llm-mock-server`、`llm-replay`、`loader-smoke` 等 | **可被消费的 npm 包**（`0.2.1-rc.5` 已发布） |

### 3.2 `package.json` 字段约定（官方风格）

以 `agent-team-profile`（bundle）与 `client-ui-agent-team`（client bundle）为例：

| 字段 | 官方做法 | 例 |
|---|---|---|
| `name` / `version` | `@deepseek-ai/dsh-*`；版本跟宿主 lockstep（`0.2.1-rc.5`） | 所有 `packages/*` |
| `publishConfig` | `{ "access": "public" }`（非 private 包） | `agent-team-profile` |
| `repository` | `git+https://github.com/deepseek-ai/deepseek-harness.git` + `directory` | 同上 |
| `type` | `"module"` | 全部 |
| `main` / `types` | `lib/index.js` / `lib/types/index.d.ts` | 全部 |
| `exports` | `"."`（types+default）、`"./client"`（客户端）、`"./cordis.patch.yml"`、`"./locale/*.json"`、`"./src/*"`、`"./package.json"`；可选 `"./typert"`/`"./remote"` | `ui-plugin-manager`、`client-ui-agent-team` |
| `files` | 只发运行时：`lib/index.js`、`lib/client.js`、`lib/types/**/*.{js,d.ts}`、`locale/*.json`、`cordis.patch.yml`、`icon.svg`；**不发 src/scripts/测试** | `agent-team-profile`、`base` |
| `license` | `MIT` | 全部 |
| `icon` | bundle 在插件页展示时 `./icon.svg` | `agent-team-profile`、`session-titles-bundle` |
| `dsh.bundle.patch` | **bundle 必需**：`./cordis.patch.yml`（也可数组按序） | `base`、`agent-team-profile` |
| `dsh.client.platform` | 客户端插件 `"web"` | `client-ui-agent-team`、`ui-plugin-manager` |
| `dsh.client.inject` | 声明依赖的 client 服务包名数组 | 同上 |
| `scripts.bundle` / `watch` | `tsdown` / `tsdown --watch`（client 包） | `ui-plugin-manager` |
| `peerDependencies` | `@deepseek-ai/cordis: workspace:~`（官方仓库内）；发布后为精确版本；镜像到 devDependencies | 全部 |
| `dependencies` | workspace 协议 `workspace:*`/`workspace:~`；运行时校验库（schemastery）放 dependencies | `agent-team-profile`、`base` |
| `engines.dsh` | **第三方/独立 bundle 用它声明支持范围**（示例 `>=0.2.0 <0.3.0`）；没有它时安装/启动会检查 `@deepseek-ai/dsh*` peer 区间 | `docs/user/develop/basic/publish.md` |

> 关键机制（官方文档明说）：**bundle 是“贡献 patch 层的 npm 包”**，profile 是“按序组合 bundle 的目录”；`dsh plugin add` 会在安装后把声明了 `dsh.bundle` 的包**自动追加**到 `dsh.profile.bundles`。profile manifest 不应手写。

### 3.3 `cordis.patch.yml` 约定

- 文件是 patch 列表；bundle layer 在 profile 组合顺序中生效（`dsh.profile.bundles` 顺序 → profile `cordis.patch.yml` → home → `--patch`）。
- 常见操作：`insert:` 新 row；或先 `- id: <official-row>; disabled: true` 再 insert 自己的 row（**官方 agent-team-profile 就是这么替换 `tool-subagent*` 四行的**，见 [`cordis.patch.yml`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/experimental/agent-team-profile/cordis.patch.yml)）。
- row 的 `id` 全局唯一；`name` 是 Node 可解析包名（bundle 内）或相对路径；`config` 附在该 row 下。
- 关闭 bundle 不动依赖：在 profile patch 里对 row `disabled: true`，或由 plugin manager 写回；卸载/升级由 plugin manager 负责。

### 3.4 构建 / 发布

- TypeScript 包：`tsc` → `lib/types/**/*.d.ts`（+ `.js` 视配置），`tsdown` → `lib/index.js` / `lib/client.js`；`bundle`/`watch` 脚本；`pnpm run build:artifacts` 走依赖顺序；`publint` 校验 exports 与构建产物一致（`docs/development.md`）。
- 发布：`publishConfig.access: public`；`private: true` 仅在禁发列表（`packages/experimental/AGENTS.md` 的 `PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES`）；workspace 协议在发布时被 pnpm 改写为精确版本。
- 兼容门禁：**安装前**读包 manifest 的 `engines.dsh` 或 `@deepseek-ai/dsh*` peer 区间，不满足直接拒绝（不下载、不跑 build script）；`compatibility.json` 可做 exact `package@version` × runtime version 的显式豁免（见 [`plugin-manager` README §Version compatibility and exemptions](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/boot/plugin-manager/README.md)）。

### 3.5 测试目录约定

| 约定 | 依据 |
|---|---|
| 测试在包级 `tests/`，不放 `src/__tests__/` | `packages/AGENTS.md` |
| Host 单测 `*.spec.ts`；Client 组件 `*.client.spec.tsx`（jsdom）；组装/真实入口 `*.e2e.ts`；构建产物 `built-lib.e2e.ts` | `packages/experimental/agent-team/tests/*`、`packages/client/ui-plugin-manager/tests/*.client.spec.tsx` |
| 生产可见插件必须有 **real-composition** 测试（真 Loader/app/进程，只 mock 外部服务） | `packages/AGENTS.md`、`docs/testing.md` |
| registry 贡献需 HMR disposal 测试 | `packages/AGENTS.md` |
| 测试工具来自 `@deepseek-ai/dsh-agent-loop-testkit`、`dsh-client-test-runtime` 等 devDependencies | 各包 devDependencies |
| 包 README 带 frontmatter（`description`、`kind`）、README.i18n.yaml、locale 文件 | `docs/cookbook/adding-a-package.md` |

### 3.6 “官方风格插件包” checklist（可打勾）

- [ ] `package.json`：`name`（scoped）、`version`、`type: module`、`main: lib/index.js`、`types: lib/types/index.d.ts`、完整 `exports`
- [ ] `dsh.bundle.patch` 指向 `cordis.patch.yml`（bundle 必需）；客户端另加 `dsh.client.platform` + `inject`
- [ ] `files` 只含运行时（lib/locale/patch/icon/README/LICENSE），不含 src、scripts、测试
- [ ] `license`、`repository`、`publishConfig.access: public`（准备发布时）
- [ ] `engines.dsh` 或 `@deepseek-ai/dsh*` peer 区间（声明兼容性；否则安装不设门槛）
- [ ] `cordis.patch.yml` 只 insert/disable；row id 全局唯一；不覆盖官方 row 行为
- [ ] Host 入口 named export `name/inject/Config/apply`，无 default export（function plugin）
- [ ] Client 入口走 `exports["./client"]`，`dsh.client.inject` 声明依赖
- [ ] `tests/`：至少一个真实入口/契约测试 + 一个纯函数/组件测试；registry 有 HMR 测试
- [ ] `README.md` 带 frontmatter + Known Limitations + 双语/`README.i18n.yaml`（若发布官方仓库）
- [ ] 版本/兼容表（测试过的 DSH 版本、`compatibility.json` 如需要）
- [ ] `publint` / `pnpm run build` 后 `lib/` 与 exports 一致

---

## 4. 对照本仓库：偏离与建议（只给建议，不改）

### 4.1 `third_party/dsh-session-tree`（我们 vendored 的 bundle）

**已对齐官方的地方**：`type: module`；`dsh.bundle.patch`；`exports["./client"]` + `dsh.client.platform/inject`；`icon`；`locale/*.json`；function plugin 的 `name/apply` 无 default export；保留上游 LICENSE；版本/上游 commit 记录在 README。

**偏离与建议**：

| 维度 | 官方惯例 | 我们现状 | 影响 | 建议 |
|---|---|---|---|---|
| 发布产物形态 | TS 包 `lib/index.js` + `lib/client.js` + `lib/types`；简单 bundle 官方教程也允许根 `index.js` | 根 `index.js` + 生成 `client.js`（339 KB），无 `types` | 官方教程允许根 JS bundle，可接受；无类型影响外部消费（但本包不作为库消费） | 在 README 明确“非 TypeScript、无 lib/types 的例外”；如要发布 npm，加 `types`/JSDoc 或声明无类型 |
| `files` 白名单 | 只发运行时（lib/locale/patch/icon） | 当前含 `client.template.js`、`scripts/`、`avatars/` | 发布包变大；`scripts` 与 template 是构建期资产，消费者不需要；头像已内嵌进 `client.js`（按 build.mjs） | 改为 `["index.js","client.js","cordis.patch.yml","icon.svg","locale","README.md","LICENSE"]`；`avatars/`、`scripts/`、`client.template.js` 留在仓库 |
| `dsh` 字段 | 官方只有 `dsh.bundle.patch`、`dsh.client.platform/inject` | 额外 `manifestVersion: 1`、`dsh.client.immediately: true` | 官方 0.2.1-rc.5 发布包中**未观察到**这两个字段（第三方 orphiczhou 上游也这么写，可能被 loader 忽略） | 删掉或核实 loader 容忍性；若行为确实依赖 `immediately`，在 README 记为“非官方扩展字段”并测试升级 |
| 测试 | `tests/` 包级测试 + 构建产物 smoke | 无 `tests/`；`npm test` 仅 `build --check` + `node --check client.js` | 不能覆盖 manifest/包装配契约 | 加 `tests/manifest.spec.mjs`：`files` 均存在、exports 可解析、`cordis.patch.yml` row name == package name、locale key 对齐、6 类头像齐全、build `--check`；CI 作为门禁 |
| peer/兼容 | 官方包声明 `@deepseek-ai/cordis` peer；第三方可用 `engines.dsh` | 完全不声明（刻意换安装面） | 不设版本门禁：DSH 升级后可能静默加载失败；换安装面的收益也要记录 | 二选一并写进 README：A) 保持无 peer（说明“测试于 rc.5，升级需自测”）；B) 加 `engines.dsh: ">=0.2.1-rc.5 <0.3.0"`，获得安装期拒绝 |
| 元数据 | `repository`、`publishConfig`（发布时） | 无 `repository`/`publishConfig` | 不影响本地 file: 安装；发布 npm 前需要 | 发布前补 `repository`（本仓库 URL）与 `publishConfig.access: public` |
| 构建脚本 | `bundle`/`watch` + 发布产物 | `build`/`test` 脚本生成 `client.js` | 无 CI 校验生成物新鲜度 | 已有 `--check`；把它放进 CI static job（见 §5） |
| 版本号 | 官方 lockstep `0.2.1-rc.5` | `1.0.4-cp.1` | 独立插件独立版本 OK；与宿主版本关系仅 README 说明 | 在 `dist/manifest.json`/README 里记录“兼容 DSH 0.2.1-rc.5”即可 |

### 4.2 `delivery/install.mjs`

**已对齐**：组件 spec 用 `file:` / `github:#sha` / `npm@exact`（官方支持形式）；`--dry-run`；安装前备份；安装后写回执；desktop 需 `--yes`。

**偏离与建议**：

| 维度 | 官方惯例 | 我们现状 | 影响 | 建议 |
|---|---|---|---|---|
| 创建测试 profile | `dsh --profile <name> --from-default-profile web` 或 `dsh plugin` 首次初始化（bundle 列表由 CLI 维护） | 缺失时**复制** `~/.dsh/profiles/web` | 会把用户 web profile 的依赖/补丁一起复制；与运行中实例并发修改有风险 | 统一走 `--from-default-profile web`（`e2e/run-e2e.mjs` 已经这样做）；`install.mjs` 里删除 cpSync 分支 |
| 登记 bundle | `dsh plugin add` 对声明了 `dsh.bundle` 的包**自动追加**到 `dsh.profile.bundles`（官方教程明说） | 安装后再手工 push 并写 `package.json` | 可能重复/顺序错/绕过 plugin-manager 的锁与失败恢复 | 删除手工写回；改为**只读校验**：`dsh --profile <p> --dump-config`（非 desktop）或 `dsh plugin --profile <p> why <pkg>`；缺 bundle 时报错 |
| profile 备份位置 | plugin-manager 自己会在失败时恢复 manifest/lock；日志在 `.plugin-manager/logs` | 备份写进 profile 内 `.control-plane-backup/` | profile 目录被塞入非 DSH 管理文件；回滚语义与 plugin-manager 重叠 | 移到 `$DSH_HOME/backups/` 或 `dist/`；文档写清“回滚用快照 + `dsh plugin remove`” |
| `dsh` 可执行默认值 | PATH 上的 `dsh`（或应用嵌入命令） | 默认硬编码 macOS app 路径 | Linux/其他机器直接失败 | 默认 `process.env.DSH_BIN ?? 'dsh'`；`desktop` 场景再单独探测 app 路径，并在报错里给出“应用内 Plugins 页”指引 |
| desktop 安装 | 官方：npm CLI 拒绝管理 desktop profile；应用内 Plugins 页或 app 自带命令（应用退出后） | CLI `--yes` 直接 add | 本机可用，但依赖 app 路径且必须在应用退出后 | README/CLI 文案把“应用内 Plugins 页”列为推荐路径；`--yes` 仅作高级用法，并检查应用是否在运行 |
| 失败恢复 | plugin-manager 失败时恢复 `package.json`+`pnpm-lock.yaml` | 自有 backup/回执 | 两套恢复机制容易互相覆盖 | 安装失败时只报告 CLI 的退出码与日志；备份仅用于人工回滚 |
| 校验 | install 前置检查 engines/peer（plugin-manager 自动做） | 无显式校验 | 首次启动才发现 bundle 未激活 | 增加 `--verify`：安装后跑只读检查（bundles 含 5 个名字、deps 存在、`--dump-config` 可见 row） |

### 4.3 `e2e/` 与 `.github/workflows/e2e.yml`

**已对齐**：真安装 DSH + 真 Chromium + 隔离 `$DSH_HOME`/state；默认官方 Messages mock（`e2e/mock-provider/official-server.mjs`）；失败截图/GIF/trace（`reporters/failure-evidence.mjs`）；零真实模型调用；端口/残留/用户 home 审计；`DSH_TELEMETRY_DISABLED`；concurrency。

**偏离与建议**：

| 维度 | 官方/同类惯例 | 我们现状 | 建议 |
|---|---|---|---|
| 测试框架 | vitest + `apps/web/tests/*.e2e.ts` + `launchWebScaffold` | 自写 `run-e2e.mjs` + Playwright test 子进程 | 保留（已跑通、真机路径清晰），但结构上向官方靠：测试文件按 spec 组织、断言/取证契约文档化；长期可迁 `session-snapshot` |
| golden | 官方 `session-snapshot`/expected-output 归一化 + `saveFailureShot` | 截图/GIF/`last-run.json`，无 golden 对比 | 中期引入官方 `@deepseek-ai/dsh-session-snapshot@0.2.1-rc.5` 做“录制一次、keyless 回放”的 golden |
| 回放 | 官方 `llm-replay`（session JSONL，按 first-call 顺序） | 自写 mock `--record/--replay`（请求 hash 匹配） | 保留 hash 回放作快速层；真实 provider 流量回放用官方 `llm-replay` |
| 依赖位置 | workspace devDependencies 统一版本 | `e2e/` 独立 `package.json` + 自己的 lock | 迁到根 devDependencies 或声明 npm workspace，避免 Playwright 版本两份 |
| flaky 策略 | 官方 e2e retry 2；浏览器 lane 串行 | `workers: 1`、`retries: 0` | 为 CI 加 `retries: 1`（仅 CI），失败证据仍是硬要求；mock 场景可保持 0 retry |
| 制品 | 失败才传（VS Code/HA/Cline） | 失败也传，但只传固定目录 | 保持；把 `if: failure()` 与 `if: always()` 分开：证据失败传，摘要 always 传 |
| 真模型 | 独立 workflow + secret preflight | `--real-model` 仅本地 | 加 `workflow_dispatch` + cron 的 real lane，keyless 时 self-skip，有 key 时 preflight 必须存在 |
| 桌面壳 | Linux 只跑 core+Web | 现 CI 只跑 Linux mock e2e | 保留 macOS 本机验收；未来自托管 macOS runner；Workflow 中把桌面项标 `NOT_APPLICABLE` |
| CI 结构 | `all-checks-passed` + 固定 OS + 聚合 | 2 个 job（e2e-mock、pack），`ubuntu-latest`，`actions/*@v4` | 加 `all-checks-passed`；固定 `ubuntu-24.04`；pin action 版本/commit；补 static/unit gate；e2e 加 path filter |
| 红测试 | 官方 CI 不会把一头红的 suite 当门禁 | 根 `npm test` 有 27 个红测试（`packages/synthetic-telemetry-ledger`），CI 注释掉 legacy-unit | 先拆 `test:gate`（绿灯子集）与 `test:research`；红测试单独立 issue，修好再并入 gate；不要把整个 suite 静默跳过 |
| 打包 | 官方 `npm pack` 产物可校验 | `pack` job 只生成 `dist/` | 加 `npm pack --dry-run` / tarball 内容断言（files 白名单、manifest 版本/兼容矩阵） |

---

## 5. 可直接照做的 checklist

### 5.1 最小 CI（本周落地版，Linux）

> 目标：**PR 10 分钟内**跑完、能挡回归、失败可取证；桌面壳不进 Linux 门禁。

1. **固定基础**：`runs-on: ubuntu-24.04`；`actions/checkout`/`setup-node` pin 到固定版本（或至少 major 一致）；`node-version: 24`；`DSH_TELEMETRY_DISABLED: '1'`；`concurrency: cancel-in-progress`。
2. **job `static`**（1–2 分钟）：
   - `node third_party/dsh-session-tree/scripts/build.mjs --check`
   - `node --check` 覆盖 `third_party/dsh-session-tree/{index.js,client.js}`、`e2e/run-e2e.mjs`、`e2e/mock-provider/*.mjs`
   - `node e2e/run-e2e.mjs --mock-model`（官方 Messages mock；静态 job 只做语法/构建/契约）
   - （新增）`node --test third_party/dsh-session-tree/tests/*.test.mjs`（manifest 契约，见 5.2）
3. **job `unit`**（先绿后严）：
   - 新增 `npm run test:gate`：跑除 `packages/synthetic-telemetry-ledger` 外的所有 `node --test`（当前 27 红集中在该研究包）；红项单独立 issue，修一个并入一个。
   - CI 只门禁 `test:gate`；`test:research` 不进 PR。
4. **job `e2e-mock`**（现有，5–8 分钟）：
   - `npm i -g @deepseek-ai/dsh@0.2.1-rc.5 pnpm@11.28.5`（或缓存）
   - `npx playwright install --with-deps chromium`（headless，**不需要 xvfb**）
   - `node e2e/run-e2e.mjs --mock-model`
   - 失败上传 evidence；`if: always()` 上传 `last-run.json` 摘要。
5. **job `package`**：
   - `node delivery/pack.mjs`
   - `npm pack --dry-run`（third_party）断言 `files` 白名单与体积
   - 校验 `dist/manifest.json` 的 spec 都是 exact/pinned。
6. **job `all-checks-passed`**：`needs: [static, unit, e2e-mock, package]`，任一非 success 即失败（防 skip 假绿）。
7. **evolve（第二阶段）**：
   - PR path filter：`third_party/**`、`e2e/**`、`delivery/**`、`.github/workflows/e2e.yml`、`docs/**`（doc-only 不跑 e2e）。
   - nightly/cron + `workflow_dispatch` real-model lane（secret + preflight；keyless self-skip）。
   - 浏览器套件 >10 分钟后：Playwright shard + blob report 合并（照 HA）。
   - 可选 Node 22.x 兼容 smoke。

### 5.2 插件包结构规范化 checklist（`third_party/dsh-session-tree`）

- [ ] `files` 改为运行物白名单：`index.js`、`client.js`、`cordis.patch.yml`、`icon.svg`、`locale/`、`README.md`、`LICENSE`（去掉 `scripts/`、`client.template.js`；`avatars/` 若确认已被内嵌则去掉）
- [ ] 删除/核实 `dsh.manifestVersion`、`dsh.client.immediately`（官方发布包未观察到；保留需在 README 标“非官方扩展”）
- [ ] 增加 `tests/manifest.test.mjs`：exports 可解析、files 每项存在、patch row `name` == package name、locale en/zh key 集一致、6 类头像 id 齐全、`build --check` 幂等
- [ ] 决定并记录兼容策略：要么加 `engines.dsh: ">=0.2.1-rc.5 <0.3.0"`（安装期门禁），要么 README 明示“无 peer 声明，rc.5 实测”
- [ ] 发布前补 `repository`、`publishConfig.access: public`；`npm pack --dry-run` 验证内容
- [ ] 在 `dist/manifest.json` 记录“兼容 DSH 0.2.1-rc.5 / 上游 commit / 头像层修改”

### 5.3 安装器 checklist（`delivery/install.mjs`）

- [ ] 测试 profile 用 `dsh --profile <p> --from-default-profile web` 创建（删除 cpSync 分支）
- [ ] 删除手工写 `dsh.profile.bundles`；改为安装后**只读校验**（bundles 包含 5 个名字 / dependencies 存在 / `--dump-config` 可见 row）
- [ ] `DSH` 默认值改为 `process.env.DSH_BIN ?? 'dsh'`，错误信息指向应用内 Plugins 页
- [ ] 备份移到 `$DSH_HOME/backups/`（或在文档说明与 plugin-manager 失败恢复的分工）
- [ ] 新增 `--verify` 子命令（只读）；`--dry-run` 保留
- [ ] desktop 路径：推荐应用内 Plugins 页；CLI `--yes` 仅高级用法且检查 app 未运行

### 5.4 E2E checklist（`e2e/` + workflow）

- [ ] CI 加 `retries: 1`（仅 CI）；本地保持 0
- [ ] `if: failure()` 上传 failure evidence + trace；`if: always()` 上传 `last-run.json`
- [ ] e2e job 加 path filter；`pack` 与 e2e 解耦
- [ ] e2e 依赖迁到根 devDependencies 或 workspace（避免两份 Playwright 版本）
- [ ] 中期接 `@deepseek-ai/dsh-session-snapshot@0.2.1-rc.5` 的 golden 结构 + `llm-replay` 做真实流量回放
- [ ] `--real-model` 提升为 `workflow_dispatch`/nightly lane（secret preflight，keyless self-skip）
- [ ] 桌面壳用例在 Linux workflow 显式 `NOT_APPLICABLE`，macOS 本机/自托管 runner 验收

### 5.5 发布 checklist

- [ ] `npm pack --dry-run` 内容 = 白名单；`manifest.json` spec 全 pinned
- [ ] `README`/`dist/INSTALL.md` 写明：目标 DSH `0.2.1-rc.5`、组件 spec、回滚命令
- [ ] `compatibility` 说明：测试于 rc.5；升级 DSH 需重跑 e2e
- [ ] 桌面安装指引：Settings → Plugins → Add plugin（应用内），而非 CLI

---

## 6. 证据链接

### 6.1 DSH 上游（固定 commit `b830ec950faba0a46dda564be3e2d854afed94f1`）

- 工作流：<https://github.com/deepseek-ai/deepseek-harness/tree/b830ec950faba0a46dda564be3e2d854afed94f1/.github/workflows>
  - `ci.yml`：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/.github/workflows/ci.yml>
  - `ci-master.yml`：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/.github/workflows/ci-master.yml>
  - `e2e.yml`：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/.github/workflows/e2e.yml>
  - `windows-package.yml` / `macos-package.yml` / `desktop-publish.yml` / `release.yml`：同目录
- 测试政策：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/testing.md>
- 开发指南：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/development.md>
- 根 `package.json`：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/package.json>
- vitest 配置：`vitest.e2e.config.ts` / `vitest.expected.config.ts` / `vitest.snapshot.config.ts` / `vitest.web.config.ts`（仓库根）
- Web 浏览器 e2e：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/apps/web/tests/README.md>
- 团队面板样例：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/apps/web/tests/agent-team-panel.e2e.ts>
- Web snapshot runner：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/scripts/run-web-snapshots.ts>
- CLI 期望输出测试目录：<https://github.com/deepseek-ai/deepseek-harness/tree/b830ec950faba0a46dda564be3e2d854afed94f1/apps/cli/tests>
- 测试基建包组：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/test-support/README.md>

**插件约定**
- 发布教程（bundle vs profile、`dsh.bundle`、`engines.dsh`、`dsh plugin add` 自动登记）：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/user/develop/basic/publish.md>
- 第一个插件（`name/apply/inject`、`ctx.effect`）：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/user/develop/basic/index.md>
- 新增包清单（package.json invariants / tsconfig / files / tests / README）：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/cookbook/adding-a-package.md>
- 包规则：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/AGENTS.md>
- 实验包规则：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/experimental/AGENTS.md>
- 示例 bundle：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/experimental/agent-team-profile/package.json> + [`cordis.patch.yml`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/experimental/agent-team-profile/cordis.patch.yml)
- 示例 client 插件：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/experimental/client-ui-agent-team/package.json> · <https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-plugin-manager/package.json>
- 兼容性/exemption：<https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/boot/plugin-manager/README.md#version-compatibility-and-exemptions>
- 官方测试包（可 npm 安装 `0.2.1-rc.5`）：`@deepseek-ai/dsh-llm-mock-server`、`dsh-llm-replay`、`dsh-session-snapshot`、`dsh-loader-smoke`、`dsh-agent-loop-testkit`、`dsh-client-test-runtime`、`dsh-remote-mock`

### 6.2 同类项目

- VS Code：<https://github.com/microsoft/vscode/blob/main/.github/workflows/pr-linux-test.yml> · <https://github.com/microsoft/vscode/blob/main/.github/workflows/sessions-e2e.yml>
- Home Assistant Frontend：<https://github.com/home-assistant/frontend/blob/dev/.github/workflows/e2e.yaml> · <https://github.com/home-assistant/frontend/blob/dev/.github/workflows/ci.yaml>
- Cline：<https://github.com/cline/cline/blob/main/.github/workflows/ext-vscode-test-e2e.yml> · <https://github.com/cline/cline/blob/main/.github/workflows/desktop-test.yml>
- Continue：<https://github.com/continuedev/continue/blob/main/.github/workflows/pr-checks.yaml> · <https://github.com/continuedev/continue/blob/main/.github/workflows/auto-fix-failed-tests.yml>
- Obsidian Sample Plugin：<https://github.com/obsidianmd/obsidian-sample-plugin/tree/master/.github/workflows>

### 6.3 本仓库现状（读取于 2026-11-02）

- vendored bundle：`third_party/dsh-session-tree/{package.json,cordis.patch.yml,scripts/build.mjs,index.js,client.js}`
- 安装器：`delivery/install.mjs`、`delivery/pack.mjs`、`delivery/uninstall.mjs`
- E2E：`e2e/run-e2e.mjs`、`e2e/playwright.config.mjs`、`e2e/profile-patch.yml`、`e2e/mock-provider/*`、`e2e/reporters/failure-evidence.mjs`
- CI：`.github/workflows/e2e.yml`（e2e-mock + pack；legacy-unit 注释）
- 测试基建细节：`docs/TEST-INFRA.md`

---

## 7. 边界与未验证

- 本文件基于 2026-11-02 的只读抓取（上游固定 commit；外部项目默认分支）；上游/外部项目后续会变，链接可能漂移。
- 我们没有在 Linux/CI 上实际跑过完整 workflow；最小 CI 是“按官方与同类项目模式推导的可执行清单”，第一次落地应先在临时分支验证。
- `manifestVersion` / `dsh.client.immediately` 是否被 loader 真正使用，本次未追 loader 源码；只确认官方 0.2.1-rc.5 发布包中没有这两个字段。
- 桌面 Electron 行为不在 GitHub Linux runner 覆盖范围；本文件不改变“macOS 本机/自托管验收”的边界。

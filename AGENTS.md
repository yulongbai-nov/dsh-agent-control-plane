# AGENTS.md — 给 AI agent 的工作说明

本仓库是 DeepSeek Harness 的外部插件控制面。人类与 agent 共用同一套工作约定；改代码前先读本文件。

## 1. 先读什么

1. `README.md` — 项目概览与快速开始。
2. `DELIVERY.md` — 当前交付物、R1–R18 覆盖矩阵、已知缺口（**唯一交付状态真源**）。
3. `docs/ARCHITECTURE.md` — 组件与测试分层。
4. `docs/TEST-INFRA.md` — mock/CI/取证约定。
5. `AGENTS.md`（本文件）— 硬规则。

历史状态（交付前）在 `docs/status.md` 文末；旧研究包在 `packages/`，不参与交付。

## 2. GitHub 工作流（所有 agent 必须遵守）

- **不直接 push `main`。** 每个改动开分支 → push → 开 PR；`main` 只通过 PR 合并。
- PR 标题/描述写清「改了什么 + 怎么验证 + 影响面」；关联 issue（如有）。
- 等待 `ci-smoke / all-checks-passed` 绿；`pr-review` 会自动评论审查清单（第一遍，非最终批准）。
- **人类 reviewer 合并**；agent 不自批、不 force-push 已 review 的分支。
- 分支命名：`feat/<topic>`、`fix/<topic>`、`test/<topic>`、`release/<version>`。
- 合并方式：squash merge，保留 PR 链接。

## 3. 硬规则

- **不修改宿主**：不要改 `/Applications/DeepSeek Harness.app`、`app.asar`、用户 `~/.dsh/profiles/desktop`。
- **真机 E2E 优先**：新功能配行为用例（`e2e/tests/*.spec.mjs`）；只有修 regression 才补最小单测。
- **一个选择**：mock 层只用官方 `@deepseek-ai/dsh-llm-mock-server`（经 `e2e/mock-provider/official-server.mjs`
  启动）；不要新增第二套 mock/第二套安装器/第二套 profile 引导。
- **零成本 CI**：CI 只跑 mock 模式；真实模型调用只在本地手动 `--real-model`（每次 2 次调用）。
- **隔离**：E2E 必须用独立 profile + `DSH_E2E_HOME`/`DSH_E2E_ROOT` 隔离；跑完审计用户 home 未变。
- **写作用域**：改 `third_party/dsh-session-tree/` 后跑 `node scripts/build.mjs`（有 `--check` 门禁）；
  改 `e2e/` 后至少跑一次 `node e2e/run-e2e.mjs --mock-model`。
- **不提交机密**：token、cookie、真实 API key 永不入库；录制文件不得含 Authorization。
- **不删除研究包**：`packages/` 是历史资产，如需清理先开 issue。

## 4. 常用命令

```sh
# 构建/校验 vendored bundle
node third_party/dsh-session-tree/scripts/build.mjs --check
node --test third_party/dsh-session-tree/tests/*.test.mjs

# 真机 E2E（官方 mock，零成本）
cd e2e && npm ci && node run-e2e.mjs --mock-model

# 安装 / 回滚（测试 profile）
node delivery/install.mjs --profile e2e
node delivery/uninstall.mjs --profile e2e

# 打包
node delivery/pack.mjs   # -> dist/*.tgz + INSTALL.md + manifest.json
```

## 5. 加一个 E2E 用例

1. 在 `e2e/tests/` 建 `NN-<主题>.spec.mjs`，用 `helpers.mjs` 的 `boot()`；
2. 尽量用 mock 模型（`--mock-model`）而不是真实调用；
3. 覆盖正例 + 至少一个边界/错误路径；
4. 断言用户可见行为，别断言具体 DOM 层级；
5. 跑 `node e2e/run-e2e.mjs --mock-model` 连跑两次稳定通过。

## 6. 加/改一个插件组件

- 包结构对齐官方：`dsh.bundle.patch`、客户端加 `dsh.client.platform/inject`、`files` 只放运行物、
  `engines.dsh` 声明已验证宿主版本、`tests/` 放 manifest 契约测试。
- 版本/来源写进 `DELIVERY.md` 与 `delivery/install.mjs` 的 `COMPONENTS`；第三方必须 pin commit/版本。
- 安装只走 `dsh plugin add`（自动登记 bundles），不要手写 `dsh.profile.bundles`。

## 7. 提交前 checklist

- [ ] `node third_party/dsh-session-tree/scripts/build.mjs --check`
- [ ] `node --test third_party/dsh-session-tree/tests/*.test.mjs`
- [ ] `node e2e/run-e2e.mjs --mock-model` 通过（两次稳定）；报告/录像生成在 `artifacts/latest/report/`
- [ ] 没有真实模型调用、没有触碰 desktop profile / 用户会话
- [ ] 文档同步（README/DELIVERY/CHANGELOG/E2E 用例说明 `e2e/test-cases.mjs`）
- [ ] 走 PR 流程（分支 + PR + CI 绿 + 人类合并）
- [ ] 如发布录像：`delivery/build-pages.mjs` + `delivery/publish-pages.mjs`（手机端 Pages）

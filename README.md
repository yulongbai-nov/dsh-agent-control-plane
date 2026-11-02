# DSH Agent 控制面（dsh-agent-control-plane）

[![ci-smoke](https://github.com/yulongbai-nov/dsh-agent-control-plane/actions/workflows/e2e.yml/badge.svg)](https://github.com/yulongbai-nov/dsh-agent-control-plane/actions/workflows/e2e.yml)

给 **DeepSeek Harness** 加一套 Agent 控制面：常驻侧栏会话树 + 六类任务头像 + 团队/嵌套 + workflow 地图 + 本地遥测 + 插件市场，**不改签名应用、不碰 app.asar**，全部以外部 profile 插件交付。

> English summary at the bottom.

| | |
|---|---|
| 宿主 | DeepSeek Harness **0.2.1-rc.5**（桌面 / web） |
| 形态 | 外部 profile 插件套件（bundle + client 插件） |
| E2E | 真实 DSH + 真实 Chromium，**28 条**行为用例，官方 Messages mock 驱动，零模型成本 |
| CI | GitHub Actions 无头流水线（Linux，core + Web GUI；桌面壳 macOS 本地验收） |
| 许可 | MIT |

## 能力与状态

| 需求 | 交付 | 状态 |
|---|---|---|
| R7 常驻侧栏会话树 | `third_party/dsh-session-tree`（vendor + 头像层） | ✅ 真机 E2E |
| R8 六类任务头像 | 同上（推断 / 手动覆盖 / localStorage 持久） | ✅ 真机 E2E |
| R1/R3/R5/R6 团队 | `dsh-agent-teams-model-override`（pinned） | ✅ 工具可见性实测；完整嵌套链路待深化 |
| R10/R11 workflow | `dsh-workflow-map` | 🟡 入口与安全打开已验证 |
| R13 安装/升级/回滚 | `delivery/` + `dshmarket` | ✅ 安装→回滚闭环实测 |
| R17 视觉/无障碍 | 深浅色 / locale / 键盘 | ✅ 基础版（真机 E2E） |
| R18 本地遥测 | `dsh-local-telemetry` | ✅ 基础版（导出/purge/重建，真机 E2E） |
| R2/R4/R9/R12/R16 | — | 🔴 路线见 [docs/REMAINING-REQUIREMENTS-PLAN.md](docs/REMAINING-REQUIREMENTS-PLAN.md)；R9 已 Hold |

完整覆盖矩阵与证据：[DELIVERY.md](DELIVERY.md)。

## 快速开始

### 装到某个 profile

```sh
node delivery/install.mjs --profile <profile>      # 普通 profile；缺失时用官方 --from-default-profile 创建
node delivery/uninstall.mjs --profile <profile>    # 回滚（快照在 $DSH_HOME/backups/control-plane/）
```

`desktop` profile 由 Electron 独占管理，推荐用应用内 **Settings → Plugins**，或在应用完全退出后
`node delivery/install.mjs --profile desktop --yes`。

### 跑真机 E2E

```sh
cd e2e && npm ci
node run-e2e.mjs --mock-model      # 官方 Messages mock，零成本（CI 用这个）
node run-e2e.mjs                   # 纯离线（不触发模型）
node run-e2e.mjs --real-model      # 可选：2 次真实模型调用
DSH_E2E_MOCK_FAULTS=1 node run-e2e.mjs --mock-model   # opt-in：模型故障边界
```

需要本机安装 DSH 0.2.1-rc.5；测试用独立 `e2e` profile（sessions/storages/telemetry 都重定向到临时目录），
脚本会审计用户 `~/.dsh` 未被改动。

## 仓库结构

```
third_party/dsh-session-tree/   vendored 侧栏树 + 六类头像（MIT，保留上游版权）
delivery/                       安装 / 回滚 / 打包（npm pack → dist/）
e2e/                            真机行为 E2E（Playwright + 官方 Messages mock + 失败取证）
docs/                           交付说明、架构、测试基建、一致性审计、剩余需求路线
packages/                       历史研究包（交付前的原型/调研，不参与交付）
dist/                           pack.mjs 生成的可发布产物（gitignored，CI 里作为 artifact）
```

## 设计原则

1. **官方为准，一个选择**：能复用官方/社区实现就不自研；mock、安装、profile 管理都只留一条官方路径。
2. **真机 E2E 优先**：行为级用例跑在真实 DSH + 真实 Chromium 上；只有 regression 才补单测。
3. **零成本 CI**：官方 Messages mock + 隔离 profile，PR 门禁不花模型钱。
4. **不改宿主**：不修改签名应用、不触碰用户 profile/会话；所有写入都要有快照/回滚。
5. **人类与 agent 都能贡献**：所有改动走 **PR 流程**（分支 → PR → `ci-smoke` 绿 → `pr-review` 自动审查 → 人类合并），
   见 [AGENTS.md](AGENTS.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Releases

最新版本见 **[Releases](https://github.com/yulongbai-nov/dsh-agent-control-plane/releases)**：
插件 tarball、`e2e-report-<version>.zip`（含每个用例的 webm 录像 + HTML 报告）、INSTALL/manifest。

## E2E 报告与录像

每次运行生成：`artifacts/latest/report/report.html`（带每个用例的 webm 录像 + 用例说明）与 `report.md`/`summary.json`。
发布版把完整报告打包成 GitHub Release 附件 `e2e-report-<version>.zip`；README 里链接最近一次 Release。

## 文档

- [DELIVERY.md](DELIVERY.md) — 交付物、覆盖矩阵、安装/回滚/打包、已知缺口
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 组件、插件模型、测试分层
- [docs/TEST-INFRA.md](docs/TEST-INFRA.md) — mock 模型 / 回放 / CI / 失败取证
- [docs/OFFICIAL-CI-AND-PLUGIN-CONVENTIONS.md](docs/OFFICIAL-CI-AND-PLUGIN-CONVENTIONS.md) — 官方与同类项目约定
- [docs/CONSISTENCY-AUDIT-2026-11-02.md](docs/CONSISTENCY-AUDIT-2026-11-02.md) — 文档与现状一致性审计
- [docs/HISTORY.md](docs/HISTORY.md) — 交付前的探索记录

## License

MIT。vendored 组件保留其上游 MIT 版权与许可（见各包 `LICENSE`）。

---

**English summary.** External plug-in suite for DeepSeek Harness `0.2.1-rc.5` that adds a persistent sidebar
session tree with six task avatars, team model overrides, a workflow map, local telemetry and a plugin market —
without patching the signed app. Behavior E2E runs against a real DSH host and real Chromium, driven by the
official Messages mock server (zero model cost). CI is a headless Linux pipeline for the core + Web UI;
the signed Electron shell is validated locally on macOS. MIT licensed.

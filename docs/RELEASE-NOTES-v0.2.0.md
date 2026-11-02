# v0.2.0 — Release notes

**DSH Agent 控制面 v0.2.0**：给 DeepSeek Harness `0.2.1-rc.5` 的外部插件套件，不改签名应用。

## 亮点

- **常驻侧栏会话树 + 六类任务头像（R7/R8）**：懒展开、工作区分组、搜索/排序、置顶/重命名/Fork/归档、
  `tree_send`；头像按任务关键词推断、可手动覆盖并持久化。
- **团队模型覆盖（R1/R3/R5/R6 面）**：pinned `dsh-agent-teams-model-override`，`spawn_teammate_with_model`
  对 agent 可见（真机实测）。
- **Workflow 地图 / 本地遥测 / 插件市场**（R10/R11/R18/R15/R13 面）。
- **安装/回滚/打包**：`delivery/`（官方 `--from-default-profile` + `dsh plugin add` + 只读校验；
  快照在 `$DSH_HOME/backups/control-plane/`）。
- **真机 E2E 28 条**：真实 DSH + 真实 Chromium，官方 Messages mock 驱动（零模型成本），
  覆盖会话树/头像/插件/市场/视觉/键盘/遥测生命周期/边界与交互韧性。
- **CI**：GitHub Actions 无头流水线（static / mock-e2e / package / all-checks-passed），
  失败自动上传截图/视频/GIF/trace。
- **文档齐全**：DELIVERY、ARCHITECTURE、TEST-INFRA、官方约定对照、一致性审计、剩余需求路线、AGENTS/CONTRIBUTING。

## 安装

```sh
node delivery/install.mjs --profile <profile>
node delivery/uninstall.mjs --profile <profile>
```

`desktop` profile 由 Electron 独占管理：用应用内 Settings → Plugins，或退出应用后 `--yes`。

## 验证

```sh
cd e2e && npm ci
node run-e2e.mjs --mock-model     # 22 passed / 6 skipped，零成本
node run-e2e.mjs                  # 19 passed / 9 skipped（离线）
node run-e2e.mjs --real-model     # 22 passed / 6 skipped（2 次真实调用）
```

## 资产

- `dsh-control-plane-session-tree-1.0.4-cp.2.tgz` — vendored 侧栏树 + 头像（MIT，运行物白名单）
- `INSTALL.md` / `manifest.json` — 安装说明与组件清单
- `e2e-report-0.2.0.zip` — E2E 报告（`report.html` 内嵌**每个用例的 webm 录像** + 用例说明 + summary）
- `e2e-report-0.2.0.md` — 同一份报告的 Markdown 版

## 已知缺口

R2/R4/R9/R12/R16 未实现（路线见 `docs/REMAINING-REQUIREMENTS-PLAN.md`；R9 已 Hold）；
R10/R11 仅入口与安全打开验收；R17 未覆盖屏幕阅读器全量；R18 未验跨重启 tombstone。

# Changelog

本项目从交付前的调研仓库（`docs/HISTORY.md`）整理为可发布的插件套件。格式参考 Keep a Changelog。

## [0.2.1] — 2026-11-03

### Added
- **头像三套画风**：每个角色（lead/research/code/write/data/qa）新增两套画风（flat sticker / watercolor），
  共 18 张；会话按 id 确定性选一套，不同会话不再千篇一律；手动覆盖仍按类型、变体保持稳定。
- **Workflow 模板库**：`workflow-templates/` 10 个可复用 DSH workflow 脚本（多文件审计、PR 三视角评审、
  多角度调研、逐文件迁移、测试缺口扫描、文档同步、依赖升级、故障初筛、内容流水线、结构化抽取），
  只依赖官方 hooks，自带编译与契约校验（CI static 门禁）。
- **工作流地图视觉 E2E**：mock 模式验证两轮会话渲染 `Main flow / steps / 节点卡`；
  真实模型模式跑一条 bash 工具调用，验证地图出现 `tools/files` 计数（可选 2 次调用）。
- 报告升级到 30 条用例、22 段录像；手机 Pages 站点同步更新。

### Fixed
- 工作流地图之前只验证“入口能打开”（无会话数据时是空图），现在必须有真实节点/计数才通过。

## [0.2.0] — 2026-11-02

### Added
- **每个用例的录像 + 排版报告**：`video: on`，`e2e/reporters/test-report.mjs` 生成
  `report.html`（内嵌播放器 + 用例说明）/`report.md`/`summary.json`；`delivery/pack-report.mjs` 打包为 Release 附件；
  `e2e/test-cases.mjs` 维护每条用例「在验证什么」。
- **PR 工作流**：`.github/workflows/pr-review.yml` 自动评论 diff 摘要 + 审查清单；`AGENTS.md`/`CONTRIBUTING.md`
  规定所有改动走 PR（不直接 push main），CI 绿 + 人类合并。
- 常驻侧栏会话树（R7）：vendor `@orphiczhou/dsh-session-tree`（MIT），懒展开、工作区分组、搜索/排序、
  置顶/重命名/Fork/归档、`tree_send`、SessionTree inspect provider。
- 六类任务头像（R8）：组长/调研/开发/写作/数据/校验；标题关键词推断、手动覆盖、localStorage 持久、
  未知回退；头像以 data URL 内嵌进单文件 bundle。
- 团队/嵌套扩展（R1/R3/R5/R6 面）：`dsh-agent-teams-model-override` pinned 引入。
- Workflow 地图（R10/R11 面）与本地遥测（R18/R15 面）：`dsh-workflow-map`、`dsh-local-telemetry`。
- 插件市场（R13 面）：`dshmarket`。
- 安装/回滚/打包：`delivery/install.mjs`、`uninstall.mjs`、`pack.mjs`（官方 `--from-default-profile` +
  `dsh plugin add` + 只读校验；快照在 `$DSH_HOME/backups/control-plane/`）。
- 真机 E2E 套件（28 条）：外壳、会话树、头像、插件/市场、workflow 入口、R17 视觉/无障碍（深浅色/locale/键盘）、
  R18 遥测生命周期、边界（重命名/置顶/归档往返、特殊字符筛选、快速折叠、长标题、窄视口、点击轰炸）、
  模型故障边界（opt-in）。
- 官方 Messages mock 驱动（`@deepseek-ai/dsh-llm-mock-server`，`$DEEPSEEK_BASE_URL` 接入），零密钥零费用；
  失败自动取证（截图/视频/GIF/trace）。
- 最小 GitHub Actions 流水线（static / mock-e2e / package / all-checks-passed）。
- 文档：`DELIVERY.md`、`docs/ARCHITECTURE.md`、`docs/TEST-INFRA.md`、`docs/OFFICIAL-CI-AND-PLUGIN-CONVENTIONS.md`、
  `docs/CONSISTENCY-AUDIT-2026-11-02.md`、`docs/REMAINING-REQUIREMENTS-PLAN.md`、`AGENTS.md`、`CONTRIBUTING.md`。

### Changed
- vendored bundle 对齐官方插件约定：`files` 只含运行物（tarball 442KB → 226KB）、删除非官方
  `manifestVersion`、补 `engines.dsh` 与 `tests/manifest.test.mjs` 契约测试。
- 安装器不再复制用户 web profile、不再手写 `dsh.profile.bundles`；改为官方 CLI 引导 + 只读校验。
- R7/R8/R13/R6 面从"原型"升级为"真机 E2E 已验收"；R17/R18 升为基础版已验收。

### Removed
- 自写 OpenAI 兼容 mock（统一到官方 Messages mock，一套实现）。
- 交付前的 VM/104 提交逐项回归计划（`docs/E2E-HANDOFF-PLAN.md`，已标记历史/弃用）。

## [0.1.0] — 交付前

见 `docs/HISTORY.md`：调研、spec、mock 与 38 个原型包（`packages/`），不参与交付。

# v0.2.1 — 头像多套画风 / Workflow 模板库 / 工作流地图视觉验收

## 亮点

- **头像不再是六张固定图**：每个角色三套画风（共 18 张），会话按 id 确定性选一套；不同会话风格不同，
  手动覆盖仍按角色类型、变体保持稳定。见录像 → 会话树截图。
- **Workflow 模板库**：`workflow-templates/` 10 个可复用脚本（官方 hooks 契约，含校验测试），
  覆盖多文件审计、PR 三视角评审、多角度调研、逐文件迁移、测试缺口、文档同步、依赖升级、故障初筛、
  内容流水线、结构化抽取。
- **工作流地图视觉真实验收**（R10/R11）：不再只验证入口——mock 模式下两轮会话渲染 `Main flow / 1 of 1 /
  N nodes`；真实模型模式跑 bash 工具后地图显示 `1 tools 0 files` 与工具接口（2 次调用，可选）。

## 资产

- `dsh-control-plane-session-tree-1.0.4-cp.3.tgz`（新增 12 张头像素材，bundle ~398KB）
- `e2e-report-0.2.1.zip`（HTML 报告 + 22 段用例录像 + summary）
- `e2e-report-0.2.1.md` / `INSTALL.md` / `manifest.json`

## 验证

- 真机 E2E：30 条用例（23 通过 / 7 跳过），含真实模型工具视觉；本机 46s。
- CI：static（build --check / manifest 契约 / workflow 模板校验）+ mock E2E + package 全绿。
- 手机回放：<https://yulongbai-nov.github.io/dsh-agent-control-plane/>

## 已知缺口

R2/R4/R9/R12/R16 未实现（R9 Hold）；R10/R11 目前验证的是“会话视图 + 工具计数”，官方 workflow 工具
的 DAG/阶段图仍由运行事件驱动，尚未做像素级快照对比。

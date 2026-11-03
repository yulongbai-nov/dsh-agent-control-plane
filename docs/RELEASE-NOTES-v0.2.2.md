# v0.2.2 — Workflow 模板拓扑视图

## 亮点

- **每个模板的「工作流视图」**：10 个模板（审计 / PR 评审 / 多角度调研 / 逐文件迁移 / 测试缺口 /
  文档同步 / 依赖升级 / 故障初筛 / 内容流水线 / 结构化抽取）渲染为阶段 + 并行分支 + 流水线视图。
  - 在线（手机友好）：<https://yulongbai-nov.github.io/dsh-agent-control-plane/templates/>
- **诚实标注**：模板用 `items.map(...)` 动态展开，保守静态分析不假装知道数量；页面以脚本声明拓扑为准，
  并显示静态分析可提取节点数/告警数。
- 真实运行时的工作流地图视图（Main flow / 节点 / tools/files 计数）见 E2E 录像（手机页 / Release 报告）。

## 资产

- `template-views-0.2.2.zip` — 模板视图静态页（可直接打开 index.html）
- `dsh-control-plane-session-tree-1.0.4-cp.3.tgz`（头像三套画风，同 v0.2.1）
- `INSTALL.md` / `manifest.json`

## 验证

- `NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" node workflow-templates/render-views.mjs` 生成 10 个模板视图。
- Pages `/templates/` HTTP 200，10 张模板卡片。
- CI（static / mock E2E / package）随 PR 运行。

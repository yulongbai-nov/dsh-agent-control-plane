# Workflow 模板库（DSH `workflow` 工具）

官方 DSH 只发布了 **脚本契约**（hooks + meta schema），没有现成的模板库。这里把最常见的
编排模式整理成 10 个可复用脚本：直接粘进 `workflow` 工具调用，或作为 prompt 的参考实现。

- 官方契约来源：`@deepseek-ai/dsh-workflow`（hooks：`agent/parallel/pipeline/phase/log/args`）、
  `@deepseek-ai/dsh-tool-workflow`（`meta` 与调用 schema）、`@deepseek-ai/dsh-workflow-ptc`（执行引擎）。
  上游仓库 `packages/workflow/` 的 README 里只有一段 `parallel` 示例，没有模板目录。
- 脚本是**纯 JavaScript 脚本体**：顶层 `await`，以 `return <JSON>` 结束；没有 fs/网络/定时器，
  所有实际工作交给 `agent()` 派出的 subagent。
- `meta.phases` 是 `[{ title, detail?, provider?, model? }]`；`args` 由调用方传入（作为全局 `args`）。

## 常用模式 brainstorm

| 模式 | 什么时候用 | 编排形状 | 模板 |
|---|---|---|---|
| 多文件代码审计 | 一次改很多文件、想知道风险分布 | `parallel` 按文件并行 → 汇总 | `templates/code-audit.js` |
| PR 多视角评审 | 合并前要正确性/安全/测试三视角 | `parallel` 3 个评审 → 裁决 | `templates/pr-review.js` |
| 多角度调研 | 一个开放问题要看技术/产品/风险 | `parallel` 多角度 → 综合 | `templates/multi-angle-research.js` |
| 逐文件迁移 | 大范围重写/迁移，互相独立 | `pipeline`（计划→修改→验证） | `templates/per-file-migration.js` |
| 测试缺口扫描 | 不知道先补哪些测试 | `parallel` 按模块扫描 → 排序 | `templates/test-gap-finder.js` |
| 文档同步 | 代码变了、文档对不上 | `pipeline`（对照→最小补丁） | `templates/docs-sync.js` |
| 依赖升级 | 批量升级依赖、怕破坏面 | `parallel` 审计 → 分步计划 | `templates/dependency-upgrade.js` |
| 故障初筛 | 线上异常，先要根因候选 | 顺序阶段：事实→假设→验证 | `templates/incident-triage.js` |
| 内容流水线 | 写文章/发布材料 | `pipeline`（研究→初稿→编辑） | `templates/content-pipeline.js` |
| 结构化抽取 | 多个来源抽同一 schema | `parallel` 抽取 → 合并去重 | `templates/structured-extraction.js` |

## 怎么用

1. **让模型调用 workflow 工具**（推荐）：把某个模板脚本全文贴进对话，说
   「用这个脚本跑 workflow，args = {...}」。模型会把它作为 `workflow` 工具的 `script` 提交。
2. **从代码里取**：

   ```js
   import { findTemplate } from './workflow-templates/index.mjs'
   const { meta, script } = findTemplate('code-audit')
   // ctx.workflowEngine.start({ script, meta, args: { files: ['src/a.ts'] }, parent })
   ```

3. **复制到自己的项目**：模板之间互不依赖，单文件即可用；按需改 prompt 与 `schema`。

## 视图（每个模板长什么样）

- 在线看：<https://yulongbai-nov.github.io/dsh-agent-control-plane/templates/>（10 个模板的阶段、并行分支、
  流水线、展开示意 + 静态分析状态）。
- 本地生成：`NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" node workflow-templates/render-views.mjs`
  → `dist/pages/templates/index.html`（用浏览器打开）。
- 说明：模板用 `items.map(...)` 动态展开，官方保守静态分析不会假装知道数量；页面以脚本里的声明拓扑为准，
  并标注静态分析能提取多少节点/多少告警。真实运行时视图（工作流地图）见 E2E 报告里的录像。

## 约定与限制

- 只使用官方契约里的 hook；脚本里出现 fs/网络/Node API 会被本仓库的测试拒绝（见 `test/templates.test.mjs`）。
- `parallel` 是屏障（等全部完成）；`pipeline` 无屏障、逐项独立，优先用 `pipeline` 处理多阶段。
- `agent()` 失败返回 `null`，用 `.filter(Boolean)`；hook 误用会终止整个脚本（官方行为）。
- 校验：`node --test workflow-templates/test/*.test.mjs`（编译、phase 引用、禁止 API、返回 JSON）。

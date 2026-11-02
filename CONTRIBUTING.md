# 贡献指南

欢迎贡献。先读 [README.md](README.md)、[AGENTS.md](AGENTS.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 开发环境

- Node.js **24**
- DeepSeek Harness **0.2.1-rc.5**（本机安装版即可；CI 用 npm CLI）
- 不需要编译；E2E 依赖 `cd e2e && npm ci`

## 工作流

1. 开 issue 描述问题/需求（或先讨论设计）。
2. 从 `main` 开分支：`feat/<topic>` / `fix/<topic>` / `test/<topic>`。
3. 改动尽量小、单一目的；行为变化必须带 E2E。
4. 本地验证（至少）：
   ```sh
   node third_party/dsh-session-tree/scripts/build.mjs --check
   node --test third_party/dsh-session-tree/tests/*.test.mjs
   cd e2e && node run-e2e.mjs --mock-model
   ```
5. 提 PR，填模板里的验证清单；CI（`ci-smoke`）必须绿。

## 测试策略

- **真机 E2E 优先**：真实 DSH host + 真实 Chromium（Playwright），用例描述用户行为。
- **mock 模型**：统一用官方 `@deepseek-ai/dsh-llm-mock-server`（Messages 协议），零费用、确定性。
- **单测**：只在修复 regression 时补最小回归测试；不为覆盖率写单测。
- **失败取证**：失败自动留截图/视频/GIF/trace（见 `docs/TEST-INFRA.md`）。

## 插件/组件变更

- 第三方插件必须 pin 版本或 commit，并在 PR 里说明来源、许可与安全审查结论。
- vendored 包保留上游 LICENSE 与版权声明，改动写在包 README 的 "本仓库改动" 一节。
- 安装相关改动跑 `node delivery/install.mjs --profile e2e` + `uninstall`，确认回滚闭环。

## 代码风格

- 纯 ESM，无构建步骤；2 空格缩进；不引入不必要依赖。
- 客户端插件是单文件 bundle（`client.js` 由 `scripts/build.mjs` 从模板生成）。
- 注释解释"为什么"，不解释"是什么"。

## 提交信息

`type(scope): summary`，type ∈ feat/fix/test/docs/chore/refactor。正文写清验证方式与影响面。

## License

贡献即同意以 MIT 许可发布。

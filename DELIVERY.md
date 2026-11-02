# DSH Agent 控制面 · 最终交付（2026-11-02）

> **状态：可安装、可回滚、可打包；真机 E2E 14/14 通过（含 2 次真实模型调用）；
> 确定性 mock 模型层 + CI 无头模式已验证（12/12），失败用例自动截图/视频/GIF/trace。**
> 目标宿主：DeepSeek Harness 桌面版 `0.2.1-rc.5`。未修改签名应用、未改动 `desktop` profile、
> 未触碰用户会话与 GUI。

## 1. 交付了什么

| 交付物 | 位置 | 说明 |
|---|---|---|
| 控制面插件集（5 个组件） | `third_party/dsh-session-tree/` + npm/git pinned | 见 §2 |
| 安装器 / 回滚器 | `delivery/install.mjs`、`delivery/uninstall.mjs` | 快照 → 安装 → 回执；回滚恢复快照 |
| 打包产物 | `dist/` | `dsh-control-plane-session-tree-1.0.4-cp.1.tgz`、`INSTALL.md`、`manifest.json` |
| 真机 E2E 套件 | `e2e/` | 14 条中文行为用例，一条命令跑完 |
| E2E 证据 | `docs/evidence/2026-11-02/` | 12 张真实 GUI 截图 + 隔离审计 `last-run.json` |

## 2. 组件与来源（全部 MIT，版本/commit 固定）

| 组件 | 来源 | 我们做的改动 | 覆盖 |
|---|---|---|---|
| `dsh-control-plane-session-tree` | vendor `@orphiczhou/dsh-session-tree@1.0.4`（commit `a534822`） | 六类任务头像 + 手动覆盖/持久化；修掉 `remote.session` 控制台报错；单文件 bundle 构建 | **R7、R8** |
| `dsh-agent-teams-model-override` | `github:funk80rus/...#1bbe089` | 无（pinned） | **R1 嵌套、R3、R5、R6 每成员模型** |
| `dsh-workflow-map` | npm `1.0.0` | 无 | **R10、R11（部分）** |
| `dsh-local-telemetry` | npm `0.2.1` | 无（E2E 中路径重定向） | **R18、R15（部分）** |
| `dshmarket` | npm `1.73.8` | 无 | **R13** |

## 3. 真机 E2E 结果

```
node e2e/run-e2e.mjs              -> 14 passed, 6 skipped   (零模型调用)
node e2e/run-e2e.mjs --mock-model -> 16 passed, 4 skipped   (官方 Messages mock，零成本，CI 用)
node e2e/run-e2e.mjs --real-model -> 17 passed, 3 skipped   (2 次真实模型调用)
```
20 条用例：01 外壳、02 会话树、03 头像、04 插件/市场、05 工作流地图、06 真实模型（3）、
07 mock 模型、08 视觉/无障碍（3）、09 遥测生命周期、99 取证自检。

| 验证点 | 结果 |
|---|---|
| 侧栏会话树在真实 GUI 渲染（工作区分组、筛选、折叠、行菜单） | ✅ 截图 `01/04/05` |
| 六类头像：推断、手动指定、刷新持久、恢复自动 | ✅ 截图 `06/07` |
| 5 个插件全部在 Plugins 页加载 + Plugin Market 入口 | ✅ 截图 `08/09` |
| 工作流地图入口可用、不崩溃、可回会话 | ✅ 截图 `10` |
| 真实登录真实模型回复 + token 用量 | ✅ 截图 `11`（回复 `2`，`Usage 12.6K tok`，Cache hit 91%） |
| `spawn_teammate_with_model` 对 agent 可见 | ✅ 截图 `12`（模型回答 `TOOL_YES`） |
| 遥测 SQLite 收到真实会话事件 | ✅ 隔离目录 rows>0 |
| 用户数据零污染 | ✅ `workspace.json`/凭据/`sessions/` 前后哈希一致 |
| 安装→回滚闭环 | ✅ 一次性 profile：5 依赖/5 bundle → 回滚后恢复原 7 bundle、0 依赖 |

## 4. R1–R18 覆盖矩阵（诚实版）

| 需求 | 状态 | 说明 |
|---|---|---|
| R1 递归团队 | 🟡 部分 | 团队插件提供 manager→worker 嵌套；工具已验证对 agent 可见；未跑 L0→L3 全链 + 第 4 级类型化拒绝 |
| R2 团队级深度 | 🔴 未交付 | 仅有原生全局 `maxDepth`，没有团队范围原子门禁 |
| R3 手动建队 | 🟡 部分 | 官方 Team 面板 + 每成员模型创建工具；无定制 roster UI |
| R4 自动建队 | 🔴 未交付 | 无候选建议/一键创建 |
| R5 归档与唤醒 | 🟡 部分 | 官方归档 + 插件冷恢复路径；归档期显式拒绝语义未测 |
| R6 Agent Spec | 🟢 基本 | 每成员 provider/model/effort 由插件承载，工具可见性已实测；真实 spawn 未在 E2E 发起 |
| R7 常驻侧栏树 | 🟢 已交付 | 真实侧栏单槽替换 + 懒展开 + 工作区分组 + 搜索/排序/归档/置顶/重命名/Fork |
| R8 六类头像 | 🟢 已交付 | 推断 + 手动覆盖 + localStorage 持久 + 自动恢复 |
| R9 任务驱动标题 | 🔴 未交付 | 与 CR-004 一致：公开 seam 无法满足「任务变化 ≤1 回合且保 pin」；需标题服务扩展 |
| R10 workflow 图 | 🟡 部分 | 工作流地图插件已装、入口可用；静态拓扑/编辑/重跑未验 |
| R11 节点看板 | 🟡 部分 | 地图内节点/进度视图可用；与 workflow 事件双向联动未验 |
| R12 缓存友好 | 🔴 未交付 | 仅遥测可见 cache 指标，无复用策略 |
| R13 安装/升级/回滚 | 🟢 已交付 | 安装器/回滚器/pack + dshmarket；回滚闭环已实测 |
| R14 权限默认 | ⚪ 未变更 | 未改权限配置；`experimental-auto-review` 仍随原 bundle 存在 |
| R15 workflow 统计 | 🟡 部分 | 遥测已落库；workflow run/source 归因未接 |
| R16 utility 库 | 🔴 未交付 | 无 registry/晋升/run_utility |
| R17 视觉与无障碍 | 🟢 已交付（基础） | 深色/浅色切换、中英 locale、键盘 Enter/Tab 已真机 E2E；屏幕阅读器未验 |
| R18 个人遥测 | 🟢 已交付（基础） | 本地 SQLite、默认不采正文、导出 JSON 无正文、purge 归零、重建已 E2E |

## 5. 安装 / 回滚 / 打包

```sh
# 测试或普通 profile
node delivery/install.mjs --profile e2e

# 正式 desktop：先完全退出 DSH 应用
node delivery/install.mjs --profile desktop --yes
# 重新打开 DSH 即生效

# 回滚
node delivery/uninstall.mjs --profile desktop --yes

# 打包（重）生成
node delivery/pack.mjs   # -> dist/*.tgz + INSTALL.md + manifest.json
```

安装器先快照 profile 的 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml` 到
`.control-plane-backup/<时间戳>/`，写回执 `.control-plane-install.json`；回滚恢复快照并
`pnpm install` 清理依赖。**desktop profile 由 Electron 独占管理**：CLI 写它前必须退出应用，
或者改用应用内 **Settings → Plugins → Add plugin**（用 `dist/` 里的 tarball 绝对路径或 npm/git spec）。

## 6. 预算

- 真实模型调用：本次交付全程约 **6 次**（含早期探测），单价为 `DeepSeek-V4.1-Flash`，
  总成本远低于 12 元预算（每次约 1.2 万 token）。
- 回归 E2E 默认零模型调用；`--real-model` 固定 2 次，不循环跑。

## 6.5 测试基建（2026-11-02 补充）

- **mock 模型层**：`e2e/mock-provider/`（OpenAI 兼容、SSE、429/500/超时注入、录制/回放、无依赖）。
  真实 GUI 验证：模型显示 `mock-echo`，零真实调用。
- **官方测试基建**：上游 `@deepseek-ai/dsh-llm-mock-server` / `llm-replay` / `session-snapshot` 等
  rc.5 已发布；DSH 默认 adapter 走 Messages 协议，建议下一步切换（见 `docs/TEST-INFRA.md` §3）。
- **CI/CD（最小版）**：npm 版 DSH 纯 Node 无头可跑（本机实测 12/12）。`.github/workflows/e2e.yml`
  是 **手动触发**的最小流水线：`static`（build --check / 语法 / 包契约 / mock 自测）、
  `mock-e2e`（官方 Messages mock，零成本）、`package`（pack + tarball 内容断言）、`all-checks-passed` 聚合。
  组织方式调研见 `docs/OFFICIAL-CI-AND-PLUGIN-CONVENTIONS.md`；升级为 PR 门禁只需取消注释触发器 + branch protection。
- **官方 mock 已接入**：默认 `--mock-model` 走 `@deepseek-ai/dsh-llm-mock-server`（Messages 协议，
  `$DEEPSEEK_BASE_URL` 指到本地 server），GUI 仍显示生产路由 `DeepSeek-V4.1-Flash`，零真实调用。
- **插件包规范化**：vendored bundle 的 `files` 只留运行物、删除非官方 `manifestVersion`、补
  `engines.dsh` 与 `tests/manifest.test.mjs`；安装器不再复制用户 web profile、不再手写 bundles，
  改为官方 `--from-default-profile` + `dsh plugin add` + 只读校验。
- **失败取证**：截图 / 视频 / GIF / trace 自动归档；GIF 由 ffmpeg 抽帧 + gifenc 合成。
- **R17 / R18 快赢**：08 视觉/无障碍（深浅色、locale、键盘）+ 09 遥测生命周期（export/purge/重建）
  已进本地 E2E；R17 剩余屏幕阅读器全量验收，R18 剩余 tombstone 跨重启验收。

## 7. 已知缺口与建议下一步

1. **R9 标题**：需扩展标题服务（fork/上游 seam），否则只能做「会话备注/标签」降级。
2. **R4 自动建队 + R16 utility 库**：各约 3–5 人日，建议基于现有团队插件的事件/任务板扩展。
3. **R2 团队级深度门禁**：需要把深度检查下沉到 subagent manager（核心改动或 fork）。
4. **R10/R11 深度**：把 `workflow-map` 的输出接到我们仓库的拓扑/看板模型，验证事件↔节点绑定。
5. **R17 全量验收**：深色、locale、键盘/读屏、窄屏需要一轮视觉/无障碍清单。

## 8. 变更边界

- 新增：`third_party/`、`e2e/`、`delivery/`、`dist/`、`docs/evidence/`。
- 未改：`/Applications/DeepSeek Harness.app`、`~/.dsh/profiles/desktop`、用户会话/凭据/工作区。
- 旧研究包保留；`docs/status.md` 已更新为交付后状态（历史表在文末）。
- 文档一致性审计：`docs/CONSISTENCY-AUDIT-2026-11-02.md`；剩余需求方案：`docs/REMAINING-REQUIREMENTS-PLAN.md`；
  测试基建：`docs/TEST-INFRA.md`。

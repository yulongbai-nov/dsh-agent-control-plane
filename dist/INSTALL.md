# DSH Agent 控制面 · 安装说明（生成于 2026-11-02T17:51:04.186Z）

目标宿主：DeepSeek Harness `0.2.1-rc.5`（已验证的真机版本）。

## 一条命令（普通 profile / 测试 profile）

在本目录执行：

```sh
dsh plugin --profile <profile> add 'file:dsh-control-plane-session-tree-1.0.4-cp.1.tgz' 'github:funk80rus/dsh-agent-teams-model-override#1bbe0891710264a5bc4b517045f785204e6a652c' 'dsh-workflow-map@1.0.0' 'dsh-local-telemetry@0.2.1' 'dshmarket@1.73.8'
```

（`dsh plugin add` 会自动把每个 bundle 登记到 profile 的 `dsh.profile.bundles` 并安装依赖；
装完重启对应实例。）

## desktop 正式 profile

desktop profile 由 Electron 应用独占管理，建议二选一：

1. **GUI**：应用内 **Settings → Plugins → Add plugin**，依次添加上面每一个 spec
   （本地 tarball 用本目录 `dsh-control-plane-session-tree-1.0.4-cp.1.tgz` 的绝对路径）。
2. **应用完全退出后**执行：
   ```sh
   node delivery/install.mjs --profile desktop --yes
   ```
   然后重新打开 DSH。

## 回滚

```sh
node delivery/uninstall.mjs --profile <profile>
```

安装器在写入前会把 profile 的 `package.json` / `cordis.patch.yml` 快照到
`.control-plane-backup/<时间戳>/`，回滚即恢复该快照。

## 覆盖范围

- `dsh-control-plane-session-tree` — R7 sidebar session tree; R8 six task avatars
- `dsh-agent-teams-model-override` — R1 nested teams; R3 roster; R5 cold resume; R6 per-member model
- `dsh-workflow-map` — R10 workflow map; R11 node/progress view
- `dsh-local-telemetry` — R18 local telemetry store; R15 run statistics (partial)
- `dshmarket` — R13 plugin install/upgrade/uninstall UX

未覆盖（需自研或上游扩展）：R2 团队级深度原子门禁、R4 自动建队、R9 任务驱动标题、
R12 复用策略、R14 默认权限终验、R16 utility 库、R17 全量视觉/无障碍验收。

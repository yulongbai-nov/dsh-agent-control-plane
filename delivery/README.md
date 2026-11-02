# Delivery：安装、回滚、打包

控制面以"组装现成插件 + 一个自研头像层"的方式交付。所有组件都以 DSH profile bundle
形式安装，不修改签名应用、不碰 app.asar。

## 组件与需求覆盖

| 组件 | 来源 | 覆盖 |
|---|---|---|
| `dsh-control-plane-session-tree` | 本仓库 vendor（上游 `@orphiczhou/dsh-session-tree`，MIT，commit `a534822`）+ 六类任务头像 | R7 常驻侧栏会话树、R8 六类任务头像 |
| `dsh-agent-teams-model-override` | `funk80rus`，MIT，pinned commit `1bbe089` | R1 嵌套团队、R3 建队、R5 冷恢复、R6 每成员模型 |
| `dsh-workflow-map` | npm `dsh-workflow-map@1.0.0`，MIT | R10 工作流地图、R11 节点/进度视图 |
| `dsh-local-telemetry` | npm `dsh-local-telemetry@0.2.1`，MIT | R18 本地遥测、R15 运行统计（部分） |
| `dshmarket` | npm `dshmarket@1.73.8`，MIT | R13 安装/升级/卸载 UX |

## 安装

```sh
# 测试 / 普通 profile（不存在时自动从 web 模板创建）
node delivery/install.mjs --profile e2e

# 正式 desktop profile（需要应用已退出）
node delivery/install.mjs --profile desktop --yes

# 只看计划
node delivery/install.mjs --profile e2e --dry-run
```

安装器会先把 profile 的 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml`
快照到 `.control-plane-backup/<时间戳>/`，再执行
`dsh plugin --profile <p> add <specs...>`，补登记 `dsh.profile.bundles`，最后写
`.control-plane-install.json` 回执。

## 回滚

```sh
node delivery/uninstall.mjs --profile e2e
# desktop 需要 --yes 且应用已退出
```

恢复快照 + `dsh plugin <p> install` 清理依赖，并校验控制面 bundle 已从列表移除。

## 打包 / 发布

```sh
node delivery/pack.mjs
# -> dist/dsh-control-plane-session-tree-<ver>.tgz
# -> dist/INSTALL.md（一条命令 + GUI 路径）
# -> dist/manifest.json（精确 spec + 覆盖矩阵）
```

`pack.mjs` 只打包 vendored 的自研 bundle；其余组件已是 npm 包或 pinned git，
发布时按 `dist/INSTALL.md` 的 spec 引用即可。发布到 npm 需要自己的账号：

```sh
cd third_party/dsh-session-tree && npm publish --access public
```

## 注意

- desktop profile 由 Electron 应用独占管理：`dsh --profile desktop --dump-config`
  会被拒绝；CLI 写 desktop 前应先完全退出应用，并保留安装器生成的快照。
- 第三方插件在 Host 进程内以用户权限运行，等价于任意代码执行；本项目只选
  MIT、无网络/无外部服务、只读本地会话数据的实现，并以 pinned 版本/commit 固定。
- `dsh-local-telemetry` 默认写 `~/.dsh/telemetry`；E2E profile 已把路径改到
  `/tmp/dsh-e2e/state/telemetry`，不影响用户数据。

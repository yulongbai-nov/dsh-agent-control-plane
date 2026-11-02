# dsh-control-plane-session-tree

左侧栏会话树 + **六类任务头像**（R7 + R8），适用于 DeepSeek Harness `0.2.1-rc.5`。

这是 [`@orphiczhou/dsh-session-tree`](https://github.com/orphiczhou/dsh-session-tree)（MIT，commit `a534822`）的 vendor 副本，由 `dsh-agent-control-plane` 追加了：

- **六类任务头像**：组长 / 调研 / 开发 / 写作 / 数据 / 校验。按会话标题、副标题和 subagent 标签做关键词推断；每行「⋯」菜单里可手动指定或「自动识别」；手动选择存在浏览器 `localStorage`（按 session id），未知回退组长头像。
- **rc.5 控制台噪音修复**：`remote.session` 命名空间在没有对应 inject 的组合里会抛错，上游把它打到 console；这里改为静默回退到 store 标题。
- 包名 / bundle 行名改为 `dsh-control-plane-session-tree`，避免和上游安装冲突。

其余行为（懒展开、按工作区分组、搜索、排序、归档筛选、置顶/重命名/Fork、右侧栏打开、`tree_send` 工具、SessionTree inspect provider）保持上游原样。

## 构建

```sh
node scripts/build.mjs          # avatars/*.png + client.template.js -> client.js
node scripts/build.mjs --check  # 校验生成物是否最新
```

`client.js` 是 DSH ModuleLoader 直接加载的单文件产物，头像以 data URL 内嵌，因此运行时不需要静态资源目录。

## 安装

```sh
dsh plugin --profile <profile> add <本目录或 tarball>
```

profile 的 `dsh.profile.bundles` 需要包含 `dsh-control-plane-session-tree`（`dsh plugin add` 会自动登记）。

## 包结构（对齐官方插件约定）

- `package.json`：`dsh.bundle.patch` + `dsh.client.platform/inject`；`engines.dsh: ">=0.2.1-rc.5 <0.3.0"`
  作为安装/启动门禁；`files` 只含运行时（`index.js`、`client.js`、`cordis.patch.yml`、`icon.svg`、`locale`、README/LICENSE）。
- 构建资产（`client.template.js`、`avatars/`、`scripts/`）留在仓库，不进发布 tarball；`prepack` 会校验 `client.js` 是否最新。
- `tests/manifest.test.mjs`：exports/files/patch row/locale/头像内嵌/engines 的契约测试（`npm test` 含 `build --check`）。
- `dsh.client.immediately: true` 是官方字段（rc.5 安装包里有 12 个包使用）；`manifestVersion` 非官方字段，已删除。

## 上游许可

上游版权与完整 MIT 许可见 [LICENSE](LICENSE)。本副本保留上游版权声明，修改部分同样以 MIT 发布。

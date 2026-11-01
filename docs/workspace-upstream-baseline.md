# Workspace UI：公开 rc.5 源码基线与获取契约

**状态：公开资料只读调查；未检出源码、安装依赖、构建、执行测试或比较安装产物。** 本文记录可核验的上游资料、调查边界和未来所需前提，不是一个可执行的构建或安装指令，也不证明原侧栏 fork 可构建、可运行或安全。

## 基线身份与等价性

- 已观察：[GitHub tag 引用](https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/tags/dsh-v0.2.1-rc.5)在调查时指向 commit `b830ec950faba0a46dda564be3e2d854afed94f1`。后续引用尽量使用此完整 commit，而不依赖 tag 永久不变。
- 转述，未在本调查中独立验证：负责人提供的已安装 runtime 构建标识是 `d4db512`。它与公开 commit 的标识不同；本次没有访问此前被拒绝的安装路径核对该标识的完整值、对象类型、来源或两者的祖先关系。
- 已观察：[公开 package manifest](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-workspace/package.json)声明版本 `0.2.1-rc.5`、仓库目录及构建输出。[npm registry 元数据](https://registry.npmjs.org/@deepseek-ai%2fdsh-client-ui-workspace/0.2.1-rc.5)也声明该版本和 tarball integrity：`sha512-T3hHWUsrOsmjhV4VIfKTNwN2UrieMxnv5W26e6aiHr7YIy9Y98xfLINe7MpSk+kb2kBKRYyup8vDRW8X435J1w==`。这个值是 registry 声明，本次未下载或校验 tarball。
- **未验证：**同版本的公开源码、registry 包和已安装 bundle 的可重复构建、字节或行为等价性；不能因为版本号相同或者标识不同，就断言它们完全相同或行为不同。

未来如获授权，应固定 commit、核验可信来源和打包 provenance；以可访问、同一对象的哈希比较 registry 包与安装产物，记录构建环境、依赖和输出。若无法重现字节一致，只能在明确范围内做契约和行为兼容性测试，不能把它写成字节等价。访问此前受限路径需由有权限的人另行提供合法访问方式或材料，不得绕过。

## 公开源码、测试及协议边界

调查时，同一公开 commit 的 Workspace UI 目录具有 [`src` 源码树](https://api.github.com/repos/deepseek-ai/deepseek-harness/git/trees/a5081d6ca03a3dbe2d4db6ca9dfa0f4511d85db6?recursive=1)和 [`tests` 测试树](https://api.github.com/repos/deepseek-ai/deepseek-harness/git/trees/7dd7cd60f6c7182c101f8f4372191c445b6017ad?recursive=1)，后者列有 12 个测试文件，包含 tree、WorkspaceBrowser、rows、apply 和 session actions。此前对安装分发物“未见源码或测试”的记录只适用于该分发物观察，**不能推出公开上游无源码或无测试**。

[上游 tree 测试](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-workspace/tests/tree.client.spec.ts)包含隐藏 subagent-origin 行、直接子代理计数、普通 fork 排序等现有行为断言；这不代表它已经实现或验证本项目所需的多层子代理侧栏。[客户端入口](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-workspace/src/client/index.ts)注册 WorkspaceBrowser、菜单操作、overlay 和 hero picker；[sidebar 入口](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-sidebar/src/client/index.ts)将 `sidebar.workspaces` 声明为 `single`。替换应保留关联注册及生命周期，不能假设可并行注册第二个同位置 occupant。

[测试运行时说明](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/test-support/client-runtime/README.zh.md)描述两类 jsdom 测试：局部 slot 档使用生产 `SlotRegistry`/renderer 并配合 Session、Workspace 测试替身；整体档以 Remote mock 启动客户端装配。默认的 `allowAllAccess` 是测试替身。它们有助于回归 UI 与生命周期，**不证明真实 Host、浏览器 GUI、网络隔离或授权正确性**。

## 构建闭包及脚本风险

已观察的上游元数据：

- [根 package manifest](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/package.json)声明 Node `^22.19.0 || >=24.0.0`、`pnpm@11.28.5`，以及 TypeScript `^6.0.3`、tsdown `^0.22.2`、Vitest `^4.1.11` 等构建/测试依赖。`workspace:*`、workspace 配置、lockfile、vendor 和 patches 都可能是精确构建闭包的一部分，不能仅复制一个 TSX 文件就声称可以构建。
- [Workspace UI tsconfig](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-workspace/tsconfig.json)继承仓库级 client 配置并引用多个 workspace TypeScript 项目；[包级 tsdown 配置](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-workspace/tsdown.config.ts)调用[共享 clientBundle 配置](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/tsdown.client.ts)。该构建路径涉及 TypeScript `lib/types` 输出、Node 入口、浏览器 `window.__ModuleLoader__.load` 工厂、external/module table、CSS Modules/lightningcss 及 bundle 输入纯度检查。
- task-28 的只读 PATH 检查仅发现 Node `v24.22.1`；`pnpm`、`tsc`、`tsdown`、`vitest` 不在当时 PATH。随后 workspace-dependencies 报告了单独捆绑的 Node 和 pnpm 脚本路径；其版本、与上游所需 pnpm `11.28.5` 的匹配及其余构建依赖均未核验。这不证明依赖闭包可用或不可用；没有运行工具链或验证能否离线构建。
- [根 manifest](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/package.json)包含 `postinstall`；[pnpm workspace 配置](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/pnpm-workspace.yaml)还声明允许或拒绝的依赖构建脚本及 patches。安装并不只是只读操作，必须事前审阅供应链和生命周期脚本。
- [Vitest 配置](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/vitest.config.ts)包含用于环境检测的 `spawnSync`。更重要的是，[真实 API E2E 配置](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/vitest.e2e.config.ts)尝试加载 `.env`，并描述凭据可用时发起真实模型调用。**不得直接运行真实模型 E2E，亦不得把上游整个 test 命令当成默认安全命令。**

## 许可与未来最小授权路径

上游根 [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/LICENSE)声明 `Copyright (c) 2026 DeepSeek`。复制或修改软件的副本或重要部分时，应保留上游版权与完整 MIT 许可通知；这不替代对其他引入依赖许可证及发布义务的单独审阅。

以下只是未来可评审的顺序，**当前没有执行**：

1. 请求用户明确授权创建隔离源码/构建工作区，获取固定 commit 和依赖，以及任何必要安装。先审阅依赖来源、lockfile、patch、install/postinstall 和拟运行测试的副作用；不可读取真实用户会话、凭据或 profile。
2. 在授权环境中记录实际 Node、pnpm、TypeScript、tsdown、依赖闭包与构建输入；先以未修改源码建立类型检查、构建产物和范围明确的合成 fixture 测试基线。若依赖闭包、可用工具或构建失败，不得声称 fork 可编译。
3. 核对来源与可重复构建，再在最小 fork 中增加隔离的身份/树逻辑；对直接父地址、跨父与同父冲突、循环、缺投影、unknown/external、归档和权限保持明确约束。保留原有分组、排序、搜索、显示水位、键盘、locale、主题及 slot 注册/卸载行为，并结合上游测试增加针对性回归。
4. 构建及合成测试通过后，仍需用户单独授权、准备并验证隔离 GUI 环境、合成 Host 和浏览器，方可评估真实 GUI E2E、安装与回滚。任何时候不得把 jsdom、mock 或静态源码检查称为真实 GUI 或安全隔离验收。

# DSH Agent 控制面

独立开发仓库，目标是在不修改签名应用的前提下实现会话树、动态团队和可视化工作流。当前为开发阶段：**尚未安装到 DSH，也没有完成 GUI 验收**。

## 当前进度

- [会话树实验包](packages/session-tree/README.md)：独立主面板，支持逐层加载、导航、六种头像和键盘操作；不是聊天时常驻的侧边栏树，R7/R8 尚未验收。
- [标题 provider 原型](packages/task-title/README.md)：只在现有的人类消息调度下读取团队任务，不能仅因任务变化刷新标题；与原 provider 互斥，不建议安装，R9 未完成。
- [工作流拓扑核心](packages/workflow-topology/README.md)：保守静态分析并生成确定性布局，不执行脚本；尚无宿主投影、运行态映射或 GUI，R10/R11 未完成。
- 已有只读 rc.5 版本和关键标记检查：通过只代表发现了预期标记，不代表运行时行为或 GUI 兼容；团队功能尚未实现。

关键实现假设修正在 [设计决策](docs/architecture-decisions.md)。原始规格、mock 与调研在相邻目录 `../dsh-mocks/`。

## 检查

需要 Node.js 24；不需要安装依赖即可运行基础检查（包括无 parser 的拓扑布局测试，但不包括完整解析器测试）：

```bash
npm test
npm run compat -- '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
```

完整拓扑解析测试需要 Acorn 8；在此机器上可仅为进程引用已存在的模块，无需安装：

```bash
NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" npm run test:workflow
```

使用已安装 Electron 只读加载真实 rc.5 会话标题服务的可选集成测试，见 [标题原型测试说明](packages/task-title/README.md#构建测试与未来集成)。

版本与标记检查只读取本机文件，不修改 profile 或 app.asar。后续真正安装、替换标题 provider 或修改用户配置之前，须先征得用户同意；现有 GUI 的只读检查不需要改配置。未经验证的功能不会标为完成。

## 缓存与复用

跟进同一任务时优先复用 teammate 的现有会话；独立短任务可新建。复用时保持 provider、model、effort、preset 和工具集稳定，避免前缀失效；缓存命中与保留时间由服务商决定，不能保证。普通 session 归档不等于成员级归档，子会话被归档后不能假设消息会正常唤醒。

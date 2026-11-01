# 真侧栏树：隔离研究切片（不可安装）

**不是 workspace fork，不是客户端插件，不接宿主、不读真实会话，R7 未实现。** 唯一代码是合成目录的候选/冲突分析，不创建树或布局、不生成导航地址、不操作 slot/GUI。不要安装进 profile、不要替换官方 sidebar。`candidate` 只指完整调用方快照中没有发现该边的身份冲突；`pending` 是总体信息不完整时的候选，**两者均不代表真实父子关系、授权、安全导航或持久事实**。

## 上游事实与 fork 可行性

本机安装包 `0.2.1-rc.5` 的 `@deepseek-ai/dsh-client-ui-workspace` 包含 `lib/client.js`（232,896 bytes、约 5,355 行）、很小的 host 入口、locale、README、manifest 和 LICENSE；虽 manifest 引用 src/types，**安装分发物内**没有对应源码、类型声明或官方测试。公开上游 [rc.5 tag](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.5) 指向 [commit b830ec950faba0a46dda564be3e2d854afed94f1](https://github.com/deepseek-ai/deepseek-harness/tree/b830ec950faba0a46dda564be3e2d854afed94f1)，存在 src 与 tests；安装版 build metadata 的 `d4db512` 身份不同，**尚未证明源码与安装构件完全等价**。客户端 bundle 经 `window.__ModuleLoader__.load` 注入 React/JSX、Cordis、client-store 和官方 UI primitives，内嵌 CSS。tsdown/tsc/pnpm workspace 构建闭包尚未安装或构建，不能认定最小 fork 已可编译，也不以修改打包 JS 作为生产方案。

官方 package 的许可证为 MIT，版权 `Copyright (c) 2026 DeepSeek`；复制/修改任何上游代码或其重要部分时必须保留原版权及 MIT 许可。此研究为独立实现，未复制上游代码或把它安装到任何地方。

实际 `WorkspaceBrowser` 通过 `slots.inject` 占用 **single** `sidebar.workspaces`，同一包还注册 `conversation.hero.workspace`、行菜单/操作和 overlay；单纯替换一部分/重复注册会遮蔽原生组件或触发生命周期冲突。现有行的 leading/hover/menu/action 是局部内容座位，不是插入多级行的稳定 seam；`sessionVisible` 原生过滤 `origin === 'subagent'`。仅取消过滤会破坏根项语义、排序/归档位置，不能实现受控父子树。

替换方案必须从已证明与目标安装版匹配的可构建源码出发，保留官方当前行为及测试：分组/平铺、workspace 层级、固定/手动与时间排序、隐藏归档/恢复和账户位置、blank、增量显示水位、搜索 debounce/abort/归档、焦点和键盘、行菜单/快捷键、权限、locale/主题、slot 声明/重注册和全部生命周期，并在授权隔离 GUI 下验证；绑定 `useSessions`/`useWorkspaces` 及真实目录懒加载，导航保留**直接父**地址和 archived/external 规则。安装/替换官方插件或回滚须用户另行明确授权，当前未进行。若上游提供正式可组合 slot 应优先评估。

已存在的 `packages/session-tree/client.template.js` 有 `catalogOf`、`buildRows`、`navigationTarget`，支持独立主面板的懒展开和直接父地址，但不是官方侧栏、没有全局跨父身份歧义检测，函数绑定其 ModuleLoader 工厂。未来应抽取共享纯逻辑而非复制两套树；本包故意只补研究中的冲突判定，不实现第二套树。

## 合成协议（非真实认证或授权）

`inspectCandidates({ roots, catalogs })`：`roots` 是调用方已根据选定 workspace、权限与原生筛选确定的一组唯一根 ID；`catalogs` 为 `Map<parentId, {provenance:'caller-reviewed', state, entries:[{id,mode}]}>`。**前提是调用方独立完成权限校验、来源审查、隔离 workspace 与脱敏**；该字符串仅是调用方输入声明，可伪造，函数无法认证来源/权限，绝不可把它或一个 Boolean 当授权证据。未经审查的外部目录不得交给本函数；生产端必须拥有可验证的宿主授权边界。

- 仅从选定根沿已审查的 `continuable`/`one-shot` 边遍历，其他 workspace 的目录不作为冲突/结果来源。`external` 为不可遍历边；`unknown` 单独标为 `unknown`，增加 `UNKNOWN_MODE` 和 `incomplete`，不得沿该边遍历，即使它的目标也有冲突亦保持 unknown 并报告冲突。没有生成任何导航目标。
- 同一 ID 出现在多个入边（包括同父重复或跨根）或也是根节点，一律报告 `AMBIGUOUS_IDENTITY`、不沿对应边向下遍历；循环进入已达节点触发冲突，不猜唯一父。冲突先在**潜在可达子图**上保守计算：某边即使经另一条歧义边而最终不展示，也可能导致其他路径的节点被判歧义，这是有意的保守误报，不应当作确证。超限/格式错误/异常返回 `invalid` 且无边；未提供或不可用目录分别报告 `MISSING_CATALOG`/`CATALOG_UNAVAILABLE`，非声明来源报告 `UNREVIEWED_CATALOG`，不展开其内容。结果 `incomplete` 时其他原候选都变为 `pending`，不表示全局唯一。
- 此算法只检查调用方提供的快照：**未给出的目录可能含额外冲突**，即使返回 `complete` 也不证明来源真实性、权限或全局无歧义。绝不能把候选直接当成 UI 授权；以后需要可信的分层 catalog 权限模型和真实 Host 集成。根与所有提供的边合计最多 1000，catalog 最多 1000；无论该目录是否可达/ready 都检查并计入，实际 Map 迭代也有 1000 项硬上限。这是合成研究的边界，不是官方上限。

### 输入与威胁模型

只接受同一 realm、普通 `Object`/null 原型记录、密集纯数据数组、原生 `Map`；严格检查 own descriptor，所有预期字段须 enumerable own data，拒绝 accessor、非预期属性、数组洞/继承索引、数据上的 Proxy（包括 revoked）、Map 自有属性或子类。检查不限选中根：未审核或不可达目录中传入的 entries 同样必须符合这些约束，但其边不参与分析。`types.isProxy` 在取原型或描述符前判断输入代理；getter 不会被主动调用。`Object.getPrototypeOf`、`Reflect.ownKeys`、`Object.getOwnPropertyDescriptor`、`Reflect.apply` 以及 Map 原生 size/entries/iterator.next 在模块初始化时取用或捕获，**依赖同 realm 内建从加载前到执行期间未受污染**；本模块不是对抗任意同进程代码或伪造内建的安全沙箱。测试仅证明对捕获的 Map entries/iterator 在加载后替换不再调用，并验证恶意 iterator 始终无法绕过实际循环次数上限；其他全局原型污染仍属信任前提。跨 realm 对象不支持。

根长度、每个 entries 长度和 Map 条目数均先检查，再按固定长度/有限次数读取，不会用输入 getter 动态增量放大结果；但 JS `Reflect.ownKeys` 要先分配整个键列表后才能拒绝额外属性，因此针对附有海量自有属性的 Map/array/record，仍可能产生瞬时 CPU/内存开销。1000 项上限不构成恶意同进程输入的完整资源隔离；产品 Host 需在更早的可信序列化/进程边界限制输入大小。

```sh
node --test packages/workspace-sidebar-spike/test/*.test.mjs
```

仅合成数据、Node 内置测试；不检查真实 React、官方 slot 编译、搜索/排序/归档与键盘可访问性，也未验证真实 GUI/安装/回滚。

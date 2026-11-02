# DSH 控制面：全提交回归与真实 E2E 交接计划

> **交接状态：计划，不是通过报告。** 本次只编写测试方案，没有逐个运行历史提交、创建 VM、启动待测 DSH/浏览器、安装产品或执行真实 E2E。实现、安装和验收均未完成；不要把本文件、mock、内存替身或静态截图标成端到端通过。
>
> **先区分两个目标：**“对每个提交建立可追溯回归证据”与“最终成品通过全部 R1–R18 的真实 E2E”是两件事。早期提交可能只是一个探针、文档或尚不完整的原型，既没有 GUI 也没有某项功能；给它标 `NOT_APPLICABLE` 或 `NOT_IMPLEMENTED` 才准确，不能强行声称其通过全部产品 E2E。最终版本仍须对全部要求实测，不因历史提交回归通过而自动通过。

## 0. 开始前 5 分钟：接手者须读

1. 先看持续更新的 [spec 真源](../../dsh-mocks/spec/DSH-控制面-spec-v0.2.md)、[设计仓库 handoff](../../dsh-mocks/handoff/NEW-SESSION-PROMPT.md)、[实现状态表](status.md)、[隔离 E2E 前置条件](../packages/sandbox-e2e/README.md) 及 [安装/回滚门槛](install-and-acceptance.md)。本文件是测试计划，不复制或降低 spec；两者冲突以**最新用户指示、最新 spec 和实际代码**为准，记录差异后重排计划。
2. 记录实现仓库、设计仓库各自 full commit、分支、dirty/untracked 状态以及 spec 文件版本和摘要。本文编写时实现基线是 `5fbd8cb2ae063dd12a7de046b82dde75ead3269e`，`main` 可达 **104 个非 merge 提交**、根是 `f54b5f4b01f115600cd44b83e8ff8c53ad7628c0`；设计仓库 `master` 是 `48d5127c7ead55c679a32febdfe43c6fe5ea9ea6`。数字只对这一不可变基线成立；开始执行时重新冻结范围，后来新增提交不能静默漏掉。
3. 此基线的 [R1–R18 状态](status.md)没有任何一项完成真实验收。已有 session-tree 主面板不是 R7 真侧栏；workflow 来源尚不可信；Team、R9、utility、持久遥测等尚有实质缺口。真正的完整产品包和可证明隔离的 E2E 环境都还没有。
4. 用户要求节省 token、尽量少用 subagent；**已取消 Astra review 要求，不要再调用 Astra 审查**。先由一个负责人串行准备、执行并整理证据；确需独立复核或 Sol/max 分析重大不确定性时才调用。旧 spec/handoff 或提交里与此冲突的 Astra 要求视为历史，不能覆盖较新的直接用户指示。
5. 非本任务目标：不要改签名应用、真实 desktop profile、个人 session/Keychain、正在运行的 DSH GUI，不发送真实模型请求或外部消息。历史测试、命令及依赖也可能有副作用：先逐版本审阅，**不是 `git checkout && npm test` 就安全**。

## 1. 交付范围与通过标准

### 1.1 历史提交回归（104 行只是当前起点）

对冻结范围内每个 Git commit 保留一行证据，至少记录：full commit / parent / 当时测试入口及依赖 / 改动分类 / 已执行层级 / 命令与环境指纹 / pass-fail-skip 计数 / 副作用和已批准写集 / 失败或不适用原因 / 日志与截图位置 / 负责人与时间。`exit 0`、构建成功、无测试文件、跳过或离线替身都不能单独叫作该提交 E2E 通过。

- 每个 commit 都需完成**审阅 + 适配该提交的最低安全自动回归**；若该提交确实有可安装且可隔离的可见交付面，依变更映射加对应真实 E2E。无法安全执行的提交保留 `BLOCKED`，不得绕过并标通过。
- 设计/文档/研究型提交通常没有独立可运行 UI：记录 diff、文档一致性与该提交当时存在的测试，GUI E2E 标 `NOT_APPLICABLE` 并写原因。**没有产品能力的功能项标 `NOT_IMPLEMENTED`，不是 PASS，也不是凭当前代码倒灌通过。**
- 最终固定 release commit：每个 **R1–R18**、安装升级卸载/回滚、隔离 canary、数据保护、真实浏览器及故障恢复都要有可复现证据；尚未实现、尚未授权、跳过、未知和有缺陷均不算通过。依据最终 spec 定义无效/过时项的适用性，不人为扩展 R14。
- 单元/属性测试 → 组件或内存集成 → 真实 Host + transport + 浏览器 + 持久化 E2E → 人工辅助检查：四层证据分别记录。运行真的 rc.5 内存模块、假的 React/Host、手工组装客户端快照都只是集成冒烟；`sandbox-e2e/preflight.mjs` 目前有意 `ready:false`，不是测试启动器。

### 1.2 测试结果状态词

| 状态 | 使用条件 | 是否计作最终通过 |
|---|---|---|
| `PASS` | 指定场景的所有断言、环境门槛和证据均完整 | 仅该场景计通过 |
| `FAIL` | 执行后断言或安全门槛失败 | 否 |
| `BLOCKED` | 未获授权、环境/依赖/产物不具备或结果不确定；记录具体原因及下一步 | 否 |
| `NOT_IMPLEMENTED` | 该提交/产品版本尚无能力 | 否 |
| `NOT_APPLICABLE` | 有可审核的适用性理由，如纯文档提交无独立 GUI | 不作为 PASS；最终要求行不可滥用 |
| `SKIP` | 测试框架跳过；需标明原因、负责人及替代证据 | 否，尤其无替代真实 E2E 证据时 |
| `UNKNOWN` | 中断、写入回执不确定、来源不可信或无法判断 | 否；先检查状态，不能盲重试 |

## 2. 当前已知状态与人类需要协助的地方

- 用户已批准免费 UTM 5.0.8、下载 Apple 恢复镜像，以及 **4 vCPU / 6 GiB RAM / 64 GiB 最大虚拟容量**的专用 VM；UTM 已安装并经单独同意打开，macOS 26.6.2 IPSW 已下载，SHA-256 与 Apple 当时返回的 CDN 元数据一致。**该记录不证明当前磁盘内容未变、不证明镜像兼容或安装签名可用。** 自动恢复镜像目录查询及无签名 Swift 本地 image-load 曾报 `VZErrorDomain` 10001 / 10004，根因未确定；UTM 图形导入结果待用户确认。不要重下镜像、升级 host 或凭同版本猜测兼容。
- 代理没有创建/启动专用 VM；是否存在其他 VM 不由此推断。UTM 近期曾打开；应向用户确认当前状态。UTM 的 Apple VM 向导默认可能启网络/剪贴板/音频输入；仅把网络设为共享或 host-only **不构成隔离**。安装可能需要 host 访问 Apple 的服务，是否需要及权限另行确认，不能因离线 guest 目标就承诺离线安装。
- UTM 源码显示启动可能清理自身临时的 `disposable-*` 项，正常退出可能尝试清理其解析的缓存目录中的直接非目录项；VM 创建可能复用已存在目标并清理 bundle 内容，安装明确会擦除**主虚拟盘**。现有许可只覆盖专用新 VM/新空盘，不覆盖其他旧数据或额外删除；**不要仅凭名称、`mkdir` 占位或 AppleScript 索引推定目标安全**。需要先核验实际 UUID、bundle 与盘的规范路径、归属、空盘、独占及风险，失败或未知即停。不要自动删除 UTM 文件、缓存、镜像、临时测试目录或用户数据。
- 最近可用磁盘曾从约 81 GiB 降至约 45 GiB，之后一次只读检查为约 57 GiB；原因未知，数据并非持续监控。开始前重新确认空闲空间和预算：镜像、稀疏盘增长、macOS 安装临时文件、浏览器、记录及回滚余量都占 host 空间；64 GiB 是 guest 逻辑上限，不是已预留空间。低空间或仍在异常变化就先停，别通过删文件自行解决。
- 本机 macOS 26.x 下，UTM 文档/脚本所述的无人值守首次 macOS 账户 provisioning 需要 host 和 guest 均为 macOS 27+；**很可能需要用户在 guest Setup Assistant 中手动建测试账户**。不要要求个人 Apple ID、密码或同步真实资料；不把秘密记入本文件或日志。
- 用户可协助：在 UTM 中确认当前页面/导入结果、选择本地 IPSW、完成新 guest 初始账户；在新 VM 停机时检查禁用 NIC、共享目录、clipboard、音频输入、USB 透传与远控，再告知结果。**先核实屏幕/当前动作再指导**，不要让用户误点已有虚拟机或 Save/Install/Start；创建/安装前完成上一条身份与空间检查。若自动操作或权限有疑问，停下来让用户决定。
- 上述 VM setup 已获批准，但 **guest 联网、在 guest 安装 DSH/浏览器/测试依赖、启动待测 DSH 服务或自动化浏览器、模型/外发、导出/删除**均需按实际版本、位置、写集和副作用另行取得适用授权。测试完成后的保留/删除另问用户；不能为“清理测试环境”自行删除。

## 3. 测试环境与安全 Gate（不满足即 BLOCKED）

### Gate A：冻结对象和工具链

- 固定测试目标 full Git SHA、parent、tag/分支、测试基线、当前 spec/handoff 版本，以及测试脚本自身 hash；记录 OS/架构、Node、依赖 lock/完整性、DSH/Electron 构件来源、包名/版本/hash、插件产物 hash 和安全审查结论。不能用版本名相同替代构件等价。公开 rc.5 源码 commit 与已装构件 metadata 尚未证明等价，见 [上游基线](workspace-upstream-baseline.md)。
- 优先**预审核的独立源代码快照/VM 内副本**；一次一个提交、独立输出目录，禁止在用户当前 checkout 中直接 checkout/rebase 或共用可变工作树。工作树、Git worktree、临时文件、产物和缓存可能被脚本写入：先明确位置、可用空间、权限、保留周期及用户授权。不要自动 checkout 运行来源不明的任意历史脚本；历史命令须先读对应 commit 的 package scripts 和实际测试实现。
- 早期 commit 的 manifest、glob、测试入口、依赖和运行假设可能与 HEAD 完全不同；例如根提交的测试入口不同于当前。不可把 HEAD 命令当成每个历史提交均可用，也不能把旧脚本暗中替换成新版。需分别登记缺失测试/依赖、范围与后补回归。
- 当前 Node v24.22.1 是一次观测，目标版本由各提交的 `engines` 决定。Acorn 缺失会让部分解析测试 skip，`test:workflow` 还可能直接失败；此前仅在进程级引用已有 Acorn 时跑过完整解析，不得将路径指向真实 profile 当成隔离策略。隔离环境需准备经批准、版本固定、可验证的依赖副本。新提交中的构建 CLI 合成测试每次会在 `TMPDIR` 创建并保留一个小目录；其他历史测试副作用需另外审计，不能预先保证全是只读。

### Gate B：实际隔离及正反 canary

- 为单次测试准备专属 VM/账户与新目录，审计绝对路径、symlink/hardlink、磁盘、权限、环境、host/guest 边界。构造 **allowlist 环境**，隔离 `HOME`、`DSH_HOME`、`DSH_AGENTS_HOME`、`XDG_*`、`TMPDIR`、cwd、browser user-data，剔除 credentials、代理、Node 注入及启动时自动加载的配置；禁默认个人 Apple ID、共享目录/剪贴板/USB/SSH。不要用 `--from-default-profile`，它可能替换/删除 profile。
- 不只看设置。用**全新合成**文件、受控凭据/Keychain、IPC 和网络 canary 做正反对照：测试进程及其 browser/renderer/utility 全子进程对 guest 内批准目录可读写，对 host/真实用户目录、其他 guest/profile、共享路径和合成敏感项拒绝；证据不读真实 Keychain/用户内容。证明符号链接、继承子进程、DNS/IPv4/IPv6/Unix socket、主机回连/监听也遵守边界。
- guest 无 NIC 只是一项措施：验证不能触及 host 的网络/共享/IPC/USB 等路径；在 guest 内以 `127.0.0.1:0` 动态监听也必须证明绑定和连接是隔离的，检查实际 socket/端口拥有者。历史本机沙盒实测 `localhost:*` 仍可能允许 `0.0.0.0`，不能作为证明。不得接当前运行的 GUI/其端口；不能假设任一旧端口仍属于目标。
- 检查真实应用默认产品 telemetry、自动任务、凭据链、远程控制、权限及插件是否全在批准范围内；启动失败、负向 canary 竟然成功或进程身份/路径变更时立即停。`READY` 只能来自实际可复现的环境证明，不能手改当前 `ready:false` 冒充通过。

### Gate C：可控安装、fixture 和过程清理

- 先构造离线 fake provider/合成工作区、session、事件、日志、任务和 token 值；没有真实模型/账号。冻结 fixture 定义、种子与预期；同时准备 scope 拒绝、损坏数据、错误/取消、异步时序、重启等负例。测试模型与用户数据都不应联网。
- 测试入口需要**真正的用户路径**：受审包 → isolated Host → 原生服务/日志及 IPC/transport → 真实浏览器 UI → 后续状态与持久重启。配置在受控 guest 内，记录服务启动回执的进程/监听所有者及确切临时 URL，浏览器只连接经过核实的该实例；token 和认证 URL 禁止写日志、截图、任务板或发给其他会话。当前环境没有已验证的浏览器自动化 seam，需用户授权提供或安装经审计的工具。
- 按版本审批安装/启用/禁用/卸载及失败回滚，确认 single-slot、注册生命周期、版本拒绝、数据库/配置迁移与恢复。快照/回滚先在合成环境证明；UTM Apple backend 是否支持 snapshot 取决于宿主和版本，当前 26.x **不能承诺**有原生 snapshot，也不能默认拷贝虚拟盘或删除。先设计经批准的替代恢复方案并核算空间。
- 服务、浏览器与监控若被允许启动，使用可追踪的 managed job、job ID、有限超时；测试结束核对全部子进程退出、端口释放、无外连/残留。异常或回执不确定时先检查具体实例，不盲目重启、停止用户进程、重试写入或清理文件。网络安装、外发、删除每项单独按用户规则审批。

## 4. 线性计划与停止条件

| 阶段 | 输入 / 行动（一个 owner，先做前项） | 出口 / 产物 |
|---|---|---|
| P0 冻结和盘点 | 重读当前 spec/handoff、冻结实现 commit 范围；核每个 commit 的 parent、变更、当时 scripts/deps/已有测试和潜在副作用；标可执行/不适用/待环境 | 可复核的全 commit 台账；未创建环境或运行历史脚本 |
| P1 新隔离环境 | 和用户确认 UTM 当前状态、空间与下一次明确动作；仅在已批准范围创建专属 VM、完成系统设置、镜像/盘身份及可恢复策略 | 明确 guest 身份、版本、资源、精确路径/UUID、失败条件；未知不安装 |
| P2 安全 preflight | 证明 Gate A/B/C、canary、受审 fake fixture 和浏览器控制；单独核对权限、网络、退出与保留政策 | 可复现的环境 PASS 证据；任何失败停止，不降级为真实环境试错 |
| P3 构建原生基线 | 在隔离 guest 按批准的固定 DSH/浏览器/toolchain 版本，证明**未修改原生产品**可启动、工作区与会话导航正常、退出/恢复可验证 | 可重复的原版 GUI/Host 基线；若上游 build/安装身份未知标 BLOCKED |
| P4 历史提交逐个回归 | 按 oldest→newest、一次一个 commit，使用独立目录；先读差异/脚本和写集，跑其适用自动测试；有可安装功能再跑对应真实路径；失败先保留证据并分类 | 覆盖清单每 commit 一行；`NOT_IMPLEMENTED`/`N/A` 有原因；不改写历史结果 |
| P5 跨功能最终 E2E | 对最终冻结 release 运行第 6 节全部适用用例，含权限/失败/重启/恢复/视觉辅助技术；不跳过未实现功能 | 每条 R、安装升级回滚及隔离用例结果和脱敏证据 |
| P6 修复与复验 | 在正常开发分支 TDD 修缺陷；新 commit 进入台账；对新版本重复受影响组件/跨功能/失败恢复测试，并重新跑 release 完整验收 | 单独标原失败和修复后结果；不得以历史通过顶替新 SHA 的证据 |
| P7 交接/决定 | 对照最新 spec、授权范围、未测/skip/风险，审计服务关闭与保留文件，发完整报告；任何需删除另问 | 签署环境、需求和 commit 覆盖矩阵，附明确未通过/阻塞项 |

**每次开始前重读更新的 spec/handoff。** 如果中途 spec、运行时、依赖、权限、产品包或隔离配置改变，冻结新版本、分析影响和重新验证 Gate；不能把旧 E2E 报告直接套到新范围。历史提交稳定时只跑增量的节省方案必须解释覆盖，最终整包的验收与回归不可省略。

## 5. 将 104 个历史提交逐项映射到测试

### 5.1 盘点与分组方法

冻结结束提交 `END`（从**确认的 full SHA**人工赋值，不从测试输出拼出可执行命令）。在当前仓库只做以下只读盘点；不写临时文件、不 checkout、不运行历史脚本：

```sh
git status --short --branch
git rev-parse HEAD
git rev-list --count HEAD
git log --reverse --topo-order --format='%H %P %s' HEAD
git show --stat --format=fuller <FULL_COMMIT>
git diff-tree --root --no-commit-id --name-status -r <FULL_COMMIT>
git show <FULL_COMMIT>:package.json
```

`<FULL_COMMIT>` 是人工核实后替换的占位符，不是可直接运行的固定命令。`git diff-tree --root` 覆盖根提交；若将来出现 merge，记录所有 parent，并明确按各 parent 比较，不能只比第一父。检查提交/manifest 后，逐项标记需哪些应用、测试数据、依赖、环境和可执行入口；不存在的 `package.json` / test 应记原因，而非拿当前 manifest 代替。

按路径与行为建立映射，**每个 commit 可属于多个类别**；仅靠 commit message 不足以决定测试：

| 变更族（示例，不是遗漏许可） | 最低回归 | 有可安装版本时还需真实路径 |
|---|---|---|
| runtime compat / ASAR `f54b5f4`→`ed9295a` | 归档长度、路径、类型、符号链接/坏数据、版本边界和失败码；只使用合成 archive | 在批准的隔离构件上验证正确拒绝/兼容，不能动签名 app |
| session-tree、头像、可访问性 `9552c0c`→`5fbd8cb` | 目录层级、缓存/冲突、父地址、未知状态、异步 fence、PNG/本地数据、generated/client、symlink CLI；四个 DOM focus skip 单独列 | 持续侧栏/真实 React 提交时序、动态移动/隐藏焦点、键盘/locale/明暗、安装卸载 |
| title/service `b7ba8b0`、`33ae4e8`、`9b6978b`→`1f88e9a` | pin、授权/修订、并发、取消、冷恢复负例；不要启用互斥 provider | 真任务事件→合法标题提交、用户 pin、关闭/重启和失败不覆盖 |
| workflow 拓扑/投影/看板/编辑 `d5f584a`、`643ea86`、`ac4c81a` 等 | parser/AST/depth/资源上限、顺序/确定布局、事件乱序/冲突/过滤、只读预览 | 真实工具 dispatch→engine→Host→UI 双向交互，来源未知和拒绝不得伪配 |
| workflow 来源/accepted-init/companion `0038e71`→`2c2b01d` 等 | 原始/有效/accepted 三边界、0..N attempts、mutable meta、重入、崩溃、unknown/冲突 | 能证明实际 engine 消费及 durable admission/恢复的授权测试；无证据保持 unknown |
| Team/Agent Spec `a610e3a`→`302980e` | 合成白名单、递归预算、门禁及被固定禁用的 native 夹具报告 | 可信已 pin 原生 baseline 后测试 spawn/send/archive/wake/嵌套/跨入口竞争；当前禁用不是通过 |
| telemetry/recommendation `6191df7`→`9aca3e4` | 全字段/精度、同序冲突、批次回滚、流式修正、schema、prototype、unknown 与建议阈值 | 授权作用域内 SQLite、cursor/tombstone、重建、导出/清除及崩溃恢复；不读真实数据 |
| E2E preflight、测试发现、docs/chore | 检查脚本变化、root suite 是否实际发现新测试、readiness 不误报、文档与权限/状态一致 | 仅当 commit 有可运行交付面才测；文档/本地忽略规则通常 GUI N/A |

上述区间仅帮助索引，台账必须覆盖 `git rev-list <END>` **所有实际对象**，包括没有逐个列出的 fix/refactor、CR 和后续提交。后续新增提交按相同规则追加。

### 5.2 每提交的建议顺序和分类

1. 用该提交的 full SHA 及 parent 审阅变更；核每个 test 的 skip、导入/子进程/文件/网络副作用，决定是否值得在干净隔离副本执行。记录编译产物是否随 commit 一起提交、是否需要构建及写入范围。对历史 `npm test` 先读脚本而非立即执行。
2. 在独立副本运行该提交**自身当时**的明确测试命令；记录 dependencies 未满足、环境不匹配和其自身已知缺陷。对经授权的修复提交，可分别证明“父版在该缺陷专属测试中失败、修复版成功”：使用**版本化的独立测试 harness**分别指向 parent/fix，记录测试 SHA、适配层、运行目标及预期差异。不能把新测试复制到旧 commit 后声称它是旧 commit 当时原生 suite，也不能不审阅地执行旧代码。
3. 对产品可运行片段，在各自兼容的隔离环境执行对应 GUI/Host 场景；早期原型只测其可达范围，明确不是最终 R7/R18。内容不涉及运行能力时写 `N/A`，但仍验证文档/脚本/包引用和安全边界。
4. 失败后记录实际 stdout/stderr 摘要、exit code、失败测试、环境、before/after 和证据；不可在历史对象上直接修改，也不 overwrite 原结果。必要时在正常开发线新 commit 修复，然后给原历史结果保留 FAIL/已知缺陷并链接修复版本的 PASS。
5. 每批结束审计本批记录与进程状态；不把断言中的临时文件、SQLite 测试、Electron 只读 smoke 或真实 GUI 混为一谈。不要默认重试失败的安装、异步调度、写入或用户交互。

## 6. 最终成品 E2E 验收矩阵

以下为计划用例，不表示当前已有实现或可执行测试。每项至少留**正例 + 反例/故障 + 身份/权限边界 + 必要时重启**的证据。最新 spec 要求高于此表时增补；无实际能力保持 `NOT_IMPLEMENTED`。

| 需求 | 真实 E2E 主路径与关键断言 |
|---|---|
| **R1 递归团队** | 在真实隔离 Team/Host 创建 root→L1→L2→L3，核父团队/作用域/消息和任务；第 4 级返回约定类型错误，跨层未授权拒绝；重启后拓扑/成员一致。 |
| **R2 深度配置** | 修改全局深度后即时生效，团队覆盖只影响本团队；测试并发 spawn、上限/非法值、越权、变更与恢复，不以绝对 `subagentDepth` 冒充相对预算。 |
| **R3 手动建队** | UI 选角色/成员/可用模型/工具创建，核真实 roster、实际 provider/能力及拒绝不支持字段；失败和部分创建状态可见。 |
| **R4 自动建队** | 固定 fake 任务产生 2–5 个候选，人工确认/撤销；没有确认不创建、不发送真实模型请求；拒绝超限和权限不足。 |
| **R5 归档/唤醒** | 归档不删除 session，归档期间所有规定的 send/queue/steer/cold-resume 入口明确拒绝；并发/掉电下无绕过，唤醒恢复同 SessionId 和预期任务。只隐藏不算归档。 |
| **R6 Agent Spec** | 同队至少两成员使用不同经批准 fake provider/model/tools，验证真正投递及能力不支持时拒绝；测试 spawn/fork/恢复、preset、预算、工具/权限及 workflow 同契约。 |
| **R7 常驻侧栏树** | 聊天时真实侧栏持续可见；L0→L3 每层按需取该层 catalog，不预抓整树；展开/收起/切换/导航直接父地址正确，其他 workspace/权限不泄漏。保留官方搜索、排序、归档、菜单和水位；主面板原型不算通过。 |
| **R8 头像** | 六类默认、未知 fallback、手动覆盖/恢复、非法/超限/解码失败保持原值，刷新和存储不可用时提示；跨会话/设备持久策略按最新 spec 明示，实际 GUI 验证。 |
| **R9 任务标题** | 合法任务变化后 ≤1 回合更新，pin 不被覆盖；用户 rename、任务重派、在途旧响应、失败/取消、冷恢复和跨 scope 拒绝；不靠伪造消息或两个冲突 provider。 |
| **R10 workflow 图** | 相同脚本重复渲染坐标/拓扑确定；事件只改状态、并行/pipeline/未知调用不猜依赖；编辑/预览/重跑在 spec 允许范围内，错误、超限与不可信来源有清晰状态。 |
| **R11 节点看板** | 图与表双向选择、筛选、状态/用量/子会话打开地址；乱序、重复、缺失、冲突、取消、未认证来源不错误绑定；筛选恢复行为和无障碍。 |
| **R12 缓存友好** | 在合成可观测 provider 上比较复用/新建、稳定身份配置、归档唤醒、cache hit 数值和报告；无可测证据显示 unknown，不承诺固定命中率。 |
| **R13 可安装升级** | 实际外部插件/必要 fork 安装、启用、禁用、重装、升级、版本不匹配拒绝与回滚；原生服务、slot、会话和用户数据不受破坏，应用签名不被改写。 |
| **R14 权限默认** | 验证默认不启用被放弃的自动审查权限；通过实际产品默认配置核对，不代表授权任何真实审查。 |
| **R15 workflow 统计** | 多 run/多 session 真实受权事件累计、去重、重建、查询与断点恢复；验证 token 是权威投影，fork 重叠、continuable 累计、缺少可信调用区间/来源时标 unknown，不重复计费。 |
| **R16 utility 库** | 已达标/未达标/unknown/阈值边界建议，人工确认晋升；版本化注册/回滚/停用后单一 `run_utility` 正确拒绝，隔离执行、输入校验、权限与幂等。 |
| **R17 官方风格/交互** | 真实界面浅/深主题并排、zh/en、窄屏/长名/空/加载/错误；键盘/焦点可见、无障碍树/屏幕阅读器与 console/slot 生命周期；不依赖 mock 截图。 |
| **R18 个人遥测** | 在单独授权的隔离 SQLite 路径回填、更新、去重、游标/来源世代、失败重启、清除 tombstone 防复活、导出/权限、保留期；WAL/SHM/目录权限，默认不存正文，工具/Remote/export 的披露分别授权。 |

**跨功能场景（至少）：**
1. 授权的 team 创建→成员不同 spec→认领任务→标题更新→R7 侧栏打开→workflow 图/看板→统计，核全部真实身份和直接父地址；归档期间消息被拒绝，唤醒同会话，重启核持久状态。
2. 控制 workflow 源码/metadata/参数被 wrapper 修改或 `next` 0/多次；证明原始事件、实际 dispatch、0..N leaf attempts、engine 消费的 accepted-init、run/job 与持久状态各自可追踪；缺边、旧历史、伪造、in-flight、receipt 已写但未调度的崩溃均是 unknown，不以名称/时间/结果成功猜关联。
3. 在统计可验证且人工确认后晋升 utility→调用→停用/回滚；部分权限、故障、取消、数据损坏与重建不泄漏正文或越权。
4. 安装/升级/卸载/回滚期间插入版本不匹配、部分写、崩溃和迁移失败，确认明确拒绝或按已批准方案恢复，原生 sidebar/title/service 不丢失；不得伪称已具备真实快照。
5. 模型只作为离线 fake provider，测试行为、事件和报告不证明真实云模型质量或 cache 命中：如需 live provider、外网、Remote 或发送数据，单独申请并设计最小许可与脱敏方案。

### 6.1 已知需真实浏览器优先重测的焦点 P2

当前 [会话树测试](../packages/session-tree/test/session-tree.test.mjs) 中有四项 `test.skip`：目录冲突隐藏当前聚焦子孙、子树换父造成路径 key 重挂载、树外/行内控件不偷焦点、根清空不聚焦 detached 节点。用真实 React/浏览器先确认目标子树确实展开、真实 focus 在哪、投影变化及 commit/cleanup 顺序，再 TDD 修复。测试在外部控件/地址栏等焦点不属于树时不得强行抢回；`tabIndex` 回退或 `activeElement === body` 不能单独证明安全恢复。仅取消 skip 或跑替身测试不等于修复。

## 7. 证据模板与统计口径

建议在**用户批准、独立且访问受限**的证据目录保存脱敏记录，不默认提交到 Git 或外传。至少包含：

```text
run_id: <无秘密的测试 ID>
subject_commit: <full SHA>                 parent(s): <full SHA>
spec_commit_and_hash: <设计仓库 SHA + spec SHA-256>
test_harness_commit_and_hash: <测试自身版本，历史回归尤其必须单列>
artifact: <版本、来源、摘要、合法取得方式>
environment: <OS/architecture/Node/DSH/browser；隔离 VM 标识、配置版本>
authorization: <已批准动作及未批准范围的引用，不记录密码/token>
isolation_canaries: <正向/负向、日期、证据 ID、结果>
case_id: <COMMIT-... 或 R1...R18-...>      class: <unit|integration|real-e2e|manual>
preconditions_and_fixture: <版本、纯合成数据种子、目标服务身份>
steps_and_expected: <可复现操作及预期，不含秘密>
observed: <实际结果、exit code、pass/fail/skip 计数>
result: <PASS|FAIL|BLOCKED|NOT_IMPLEMENTED|NOT_APPLICABLE|SKIP|UNKNOWN>
limitations_and_follow_up: <缺口、owner、关联缺陷或修复 SHA>
evidence: <相对证据目录 ID；不含 token、个人 session、绝对隐私路径>
process_cleanup: <实际受控进程/端口关闭证据；文件保留和已授权处理>
```

- 聚合至少输出 `total commits = PASS + FAIL + BLOCKED + NOT_APPLICABLE ...` 与 **每一行的层级**；不要把 `NOT_APPLICABLE` 加入通过率。对最终 R1–R18 分子仅计真实 E2E PASS，分母为最新 spec 适用要求；未证实分母/授权范围显示 unknown。
- 对 skip 保留原始原因及源码位置；缺测试、代码不存在、依赖缺失、安全阻断、功能不适用分开统计。错误/中断的每次 attempt 分开保留，不把重跑成功覆盖历史失败。
- 日志、DOM 快照、screenshots、video、崩溃文件及 SQLite 均可能含账号、路径、正文或连接 token，保存前做内容审查和权限限制；用合成数据，标明留存时间和负责人。文本摘要去标识不等于能恢复的备份。

## 8. 人工接手 checklist

- [ ] 我已读取最新 spec、handoff、本方案与已批准范围；识别旧文档中已撤销的 Astra 要求不适用。
- [ ] 我冻结实现/设计/测试 harness 的 full SHA，并生成一份完整 commit 台账；之后的新提交会另加行。
- [ ] 我能解释 `PASS / N/A / NOT_IMPLEMENTED / BLOCKED / UNKNOWN / SKIP` 的区别，以及为什么历史早期提交不可能都通过最终 R1–R18 E2E。
- [ ] 用户已确认 UTM 当前界面、实际空间、该次 VM 目标和镜像导入状态；未使用个人账号、未改 host、未删除旧内容。
- [ ] VM/新盘 UUID、规范路径、空盘及冲突风险和可恢复策略已审计；按需取得具体安装、guest 网络、工具与测试授权。
- [ ] 文件/Keychain/IPC/子进程/网络/服务身份等正反 canary 全部有证据，fixture 与 fake provider 只用合成数据；浏览器精确连接受控实例。
- [ ] 历史每个 commit 的测试版本、适用性、结果和证据完整；缺依赖、skip、旧缺陷及修复分开记录。
- [ ] 最终版本 R1–R18、跨功能、安装/升级/失败回滚、真实 GUI/视觉/无障碍、重启/恢复均有通过证据；否则诚实标注未完成。
- [ ] 无未授权清理或外发；受控进程和端口已按批准方案关闭，保留物和后续删除由用户决定。

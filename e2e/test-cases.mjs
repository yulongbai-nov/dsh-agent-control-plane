/**
 * Case catalog: a one-line human description for every E2E case.
 *
 * The reporter matches `match` against the full Playwright test path and attaches
 * `what` to the report. Keep this in sync when adding a case (AGENTS.md checklist).
 */
export const TEST_CASES = [
  {
    group: '外壳',
    match: /打开应用后侧栏显示会话树/,
    what: '打开真实 DSH Web UI，侧栏渲染出会话树（Sessions 标题、筛选框、来自 Host 的真实会话行）。验证 R7 常驻侧栏。',
  },
  {
    group: '外壳',
    match: /点击新建会话/,
    what: '点击「新建会话」，主面板出现输入框与工作区信息；验证会话创建入口可用。',
  },
  {
    group: '外壳',
    match: /没有未捕获的 JS 错误/,
    what: '打开应用并渲染后，页面无未捕获异常；console 只允许已知无害的 deepseek-account 提示。',
  },
  {
    group: '会话树',
    match: /工作区分组可展开\/折叠/,
    what: '工作区分组行可折叠/展开，aria-expanded 正确，会话行来自真实 Host 数据。',
  },
  {
    group: '会话树',
    match: /筛选框按标题过滤/,
    what: '筛选框输入不存在标题时会话行清零，清空后恢复。',
  },
  {
    group: '会话树',
    match: /行「⋯」菜单/,
    what: '会话行「⋯」菜单含置顶/重命名/Fork/归档 + 7 个头像选项（6 类型 + 自动识别）。',
  },
  {
    group: '头像',
    match: /每个会话行渲染角色头像/,
    what: '每行渲染角色头像（lead/research/code/write/data/qa），三套画风按会话 id 确定性随机；不同会话风格不同。',
  },
  {
    group: '头像',
    match: /手动指定头像后刷新仍保留/,
    what: '手动把头像改成「开发」→ 刷新页面仍保留（localStorage 持久）→ 可恢复自动识别。',
  },
  {
    group: '插件',
    match: /Plugins 页面列出控制面全部已装插件/,
    what: 'Plugins 页列出 5 个控制面组件（session-tree、teams-model-override、dshmarket、local-telemetry、workflow-map）。',
  },
  {
    group: '插件',
    match: /Plugin Market 入口/,
    what: 'dshmarket 在 Plugins 页提供 Plugin Market 入口并可点开。',
  },
  {
    group: 'Workflow',
    match: /两轮会话渲染出分步流程/,
    what: '真实跑两轮对话后打开工作流地图：Main flow、步骤计数与节点卡真实渲染（R10/R11 视觉）。',
  },
  {
    group: 'Workflow',
    match: /真实模型工具调用后/,
    what: '真实模型执行一条 bash 工具调用后，地图显示 tools/files 计数（R10/R11 真实数据，可选 2 次调用）。',
  },
  {
    group: 'Workflow',
    match: /工作流地图入口/,
    what: '侧栏「工作流地图」入口存在、打开不崩溃、可以回到会话（入口级保障）。',
  },
  {
    group: '模型',
    match: /确定性 mock 模型层/,
    what: '用官方 Messages mock 作为模型层，发消息收到确定性回复；mock 记录证明零真实调用。',
  },
  {
    group: 'R17 视觉',
    match: /深色主题/,
    what: '真实 Settings 切换到深色主题，会话树仍渲染且不崩溃，切回浅色复核主题属性。',
  },
  {
    group: 'R17 视觉',
    match: /中英 locale/,
    what: '中英切换后侧栏文案跟随（含切回英文）。Linux CI 上跳过，由 macOS 本地验收。',
  },
  {
    group: 'R17 交互',
    match: /键盘：Enter 激活/,
    what: '纯键盘操作：Enter 新建会话、Tab 进入会话树、Enter 打开行菜单；并记录树行不可聚焦的产品缺口。',
  },
  {
    group: 'R18 遥测',
    match: /遥测生命周期/,
    what: '导出 JSON（合法且不含 prompt 正文）→ purge 后 rows 归零 → 新消息后 rows 恢复。',
  },
  {
    group: '故障边界',
    match: /429 限流/,
    what: '模型层返回 429，真实 Host 重试耗尽后 UI 显示可读错误且不崩溃（opt-in，需要 mock 控制面）。',
  },
  {
    group: '故障边界',
    match: /500 服务错误/,
    what: '模型层 500 → 错误可读；同实例换新会话后恢复成功（opt-in）。',
  },
  {
    group: '边界',
    match: /重命名 → 置顶 → 归档/,
    what: '重命名 → 置顶（置顶行排第一）→ 归档（默认隐藏）→ 显示已归档 → 取消归档，真实 Host 状态往返。',
  },
  {
    group: '边界',
    match: /正则\/emoji 等特殊字符/,
    what: '筛选框输入正则元字符、emoji、HTML 片段、超长串均不崩溃，清空后恢复。',
  },
  {
    group: '边界',
    match: /快速连续展开\/折叠/,
    what: '连续 15 次快速展开/折叠工作区，ARIA 状态合法、无未捕获异常。',
  },
  {
    group: '边界',
    match: /超长标题/,
    what: '发送超长标题消息后，会话行文本被截断（ellipsis/clip），不撑破侧栏宽度。',
  },
  {
    group: '韧性',
    match: /窄视口/,
    what: '900×700 窄视口下侧栏自动收成图标栏 → 可展开，树与行菜单仍可用。',
  },
  {
    group: '韧性',
    match: /连续开关行菜单/,
    what: '连续 20 轮开关行菜单 + 反复筛选后 UI 未卡死、无未捕获异常。',
  },
  {
    group: '真实模型（可选）',
    match: /短消息收到真实回复|真实模型层/,
    what: '用户真实登录：一条短消息收到回复并产生 token 统计（每次 1 次调用，仅手动运行）。',
  },
  {
    group: '真实模型（可选）',
    match: /团队插件把/,
    what: '模型回答工具列表中存在 spawn_teammate_with_model（R1/R6 面可用性，1 次调用）。',
  },
  {
    group: '真实模型（可选）',
    match: /遥测插件把真实会话事件/,
    what: '真实会话事件被本地遥测 SQLite 记录（R18 面）。',
  },
  {
    group: '取证自检',
    match: /故意失败/,
    what: '仅 DSH_E2E_SELF_FAIL=1 时运行：故意失败，用于验证截图/视频/GIF/trace 取证链路（opt-in）。',
  },
]

/** Best-effort description lookup for a full test path. */
export function describeTest(fullTitle) {
  return TEST_CASES.find((entry) => entry.match.test(fullTitle)) || { group: '未分类', what: '' }
}

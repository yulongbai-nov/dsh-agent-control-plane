# Workflow topology 核心

仅分析脚本，不运行、不求值。此包不提供 DSH 插件、实时投影或 UI。输入是 workflow 工具的 JavaScript `script` 脚本体和 JSON `meta`，支持顶层 `await`/`return`。parser 是可信依赖：优先使用普通 Node 模块解析找到的可选 peer `acorn` 8，或者由调用方注入相同签名的 `parse`。缺 parser 返回 `PARSER_UNAVAILABLE`，没有静默的简化解析器。

```js
const { extractTopology, layoutTopology } = require('@dsh-agent-control-plane/workflow-topology')
const skeleton = extractTopology(script, meta) // 可选第三参 { parse: acorn.parse }
const layout = layoutTopology(skeleton)
```

`extractTopology` 返回 `{version, nodes, edges, groups, phases, warnings, complete}`：

- `nodes` 为可静态识别的 `agent()` 调用；`id` 是源代码偏移与静态展开路径，`source` 为零基字符区间，`occurrence` 为 `single` 或不对应具体次数的 `template`。`label/phase/provider/model/schema` 未知时为 `null`。ID 只保证同一份脚本内稳定，编辑脚本后可能变化。
- `edges` 表示前一个已等待的 agent 完成后才会启动后一个 agent 的依赖；不代表所有可能的执行路径。并行 thunk 使用数组顺序；字面量 pipeline 的每个 item 单独串联，阶段之间没有全局 barrier。未知数量仅输出 `template` 调用点，绝不假装已知展开数量。
- `groups` 的 `members` 是节点或嵌套组 ID；`expansion` 表明是否是具体展开。`warnings` 是 `{code, offset, message}`，`complete: false` 时必须提示用户结构不完整/不确定，不能将未出现的节点解释为不会执行。语法错误同样返回告警和空骨架。
- `layoutTopology(skeleton)` 返回独立 `{version,nodes,groups}` 坐标；按 `meta.phases` 排列已知阶段，其余独立列；无声明阶段时按顶层语句。行按提取前序，组边界由成员包围盒组成；它不读取 status 或事件，也不修改骨架。空组的 `bounds` 为 `null`。

保守子集：直接调用 `agent`、`phase`、`log`，以及 `parallel` 的字面量内联 thunk、`pipeline` 的字面量 items + 内联 stages。条件、循环、函数引用、带副作用的表达式、动态配置、声明/赋值遮蔽 hook 等均告警，未知依赖被省略；不处理闭包、变量传播或 JS 任意语义。执行可能提前抛错或取消，静态骨架不是运行结果。脚本及 AST、展开数有硬上限，触及上限返回告警和不完整骨架。`meta` 和 parser 由可信宿主作为数据与依赖传入，而非来自脚本运行的 JS 对象。

本机无需安装即可验证（`NODE_PATH` 仅配置测试进程的模块解析，产品代码无机器路径）：

```sh
NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" node --test packages/workflow-topology/test/*.test.cjs packages/workflow-topology/test/*.test.mjs
```

解析套件（`.test.cjs`）需要 Acorn 8；通用环境必须自行提供依赖。根目录默认命令能独立运行无需 parser 的 `.test.mjs` 布局/缺失依赖测试，但不能替代上述完整解析套件。上游 `workflow/agent-start` 的 `{seq,label,phase,childId}` 没有调用位置，且 seq/事件顺序受并发影响：重复 label、动态 label 和循环/管线的一对多调用不能可靠绑定。本包不实现也不暗示事件映射；宿主必须另行处理未匹配/歧义状态，并保证运行时覆盖不重排静态坐标。阶段、模型等来自脚本，仅在解析值确定时提供；不会用未知运行时信息填充。

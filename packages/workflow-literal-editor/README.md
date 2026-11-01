# Workflow 字面量编辑预览

纯函数、保守子集：只给出候选新脚本和单处文本 diff；**不执行、不重跑、不发消息、不写文件**。只接受可信 Acorn 8 parser（正常 Node 解析可用的可选 peer，或注入 `parse`），复用同仓库 `workflow-topology`；无 parser、AST 不确定或未通过完整原生 async wrapper 校验时拒绝。

```js
const {inspectScript, previewEdit} = require('@dsh-agent-control-plane/workflow-literal-editor')
const before = inspectScript(script, {parse: acorn.parse})
if (before.ok && before.targets.length) {
  const preview = previewEdit({script, target: before.targets[0], field:'model', value:'model-id'}, {parse: acorn.parse})
  // preview.ok 时人工检查 preview.diff 和 preview.script；不要自动提交/执行。
}
```

`inspectScript` 成功返回 `{ok:true,sourceHash,targets,topology,layout}`；每个 target 为 `{sourceHash,nodeId,start,end,fields}`，span 是原始脚本的 UTF-16 零基半开区间，与 JS/Acorn 一致。`sourceHash` 是完整 `SHA-256(UTF-16LE code units)`，避免 UTF-8 编码对未配对代理项的替换碰撞。target 仅对**完全相同的原脚本**有效，预览时重新解析并核对 hash、节点 id 和 span；调用方不得从 label 或运行事件猜选调用点。

`previewEdit` 输入 `{script,target,field,value}`，成功返回 `{ok:true,script,diff:{range:{start,end},before,after},nodeMapping,topology,layout}`；diff 是单处精确替换（不是 shell patch），新值用 `JSON.stringify` 安全编码为 JS 字符串字面量。只可修改已有 `prompt`、`provider`、`model`、`label` 的字符串字面量，不能插入字段；prompt 必须非空且须显式 label，否则会连带改变运行时默认 label。provider/model 要求非空、无首尾空白（保守限制，不保证实际 provider/model 可用）；label 可以为空，但与其他节点重复会拒绝。`nodeMapping` 将旧节点 id 映射到新脚本 id；源码 offset 变化使 id 可变化，**不能假定跨编辑稳定**。新旧节点数、边的序号关系与每个节点的列/行/坐标/大小必须相同，否则拒绝预览。只检查一个节点字段，失败始终 `{ok:false,code}` 且不返回修改后的脚本。为限制同步解析成本，脚本和新字符串各限 100,000 个 UTF-16 code units，超过即拒绝。

当前只支持整个脚本是顶层 `await agent('literal', {label:'literal',provider:'literal',model:'literal'})`、静态 `phase('literal')` 及空语句，标量字符串也可用双引号。若存在变量声明、函数、循环/条件、parallel/pipeline、重名、动态字符串或模板、hook 重绑定、可执行表达式、spread、computed/getter/shorthand、额外/重复选项、解析错误、包装逃逸、不完整拓扑或多重实例则整体拒绝。parser 为可信注入依赖，而非执行不可信脚本；输入参数对象/target/options 必须是无 getter 的非代理 plain record。当前**不支持 args JSON 和 meta.phases 编辑**：它们来自工具调用外层数据，不在脚本文本中；没有可信/原子序列化和来源契约，不读取 getter，不伪造支持。也不接 UI/持久化/审批/重跑、其他 Agent Spec 字段或真实会话。

当前布局只按空 meta 调用 `layoutTopology`，不涉及尚未传入的真实 `meta.phases`；要对完整 workflow 保证相同坐标必须由调用方使用真实 meta 再做对账，不能把本预览当成完整 host 集成。rc.5 使用 `opts.label ?? defaultLabel(prompt)`，显式空 label 不触发 fallback；该情况已有测试。脚本字符串本身有敏感信息风险，宿主不应默认日志或外发 diff。

**CR-005：本包不执行重跑。** spec §6.4 的 A 档规划是用户确认后由普通消息交给 agent，由模型决定是否重新调用 workflow；不是图编辑器直接执行，也不是保证模型会原样运行候选脚本。消息、潜在外发、权限及实际运行均须另行获得所需授权并处理；这条模型中介路径目前同样未接入。

完整测试（零安装使用本机已有 Acorn，产品代码无机器路径）：

```sh
NODE_PATH="$HOME/.dsh/profiles/desktop/node_modules" node --test packages/workflow-literal-editor/test/*.test.cjs packages/workflow-literal-editor/test/*.test.mjs
```

不设 `NODE_PATH` 且 Node 找不到 Acorn 时，`.test.cjs` 明确 skip；无需 parser 的 `.test.mjs` 基础拒绝测试仍运行。这不是完整安全测试。根命令可包含两种后缀，完整套件须提供可信 Acorn 8。

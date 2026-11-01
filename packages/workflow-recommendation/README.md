# Workflow 晋升建议：保守规则原型

**不是 DSH 插件，也不是 R15/R16 完成品。** `recommend(input)` 是同步纯函数，只评估调用方给出的合成聚合；不扫描/存储任何会话，不调用宿主、模型、工具、网络或文件，不执行晋升，不输出 score、suggested 或原始数据。规则的建议与用户最终确认是两回事。

## 合成输入契约与重要限制

```js
import { recommend } from './index.mjs'
const result = recommend({
  evidence: 'caller-asserted-complete',
  runs: 10, ok: 8, failed: 2, cancelled: 0, unknown: 0,
  distinctSessions: 2, argsVariants: 2,
  lastUsedMs: 1769688000000, nowMs: 1769860800000,
}) // { verdict: 'candidate', reasons: [...] }
```

- 调用方**自行断言**这些是同一稳定 workflow 身份、同一时间范围内已去重且完整的合成聚合：`evidence` 固定字符串不构成任何实际来源证明或授权；本函数无法验证可信性、范围完整性、来源、版本口径或跨库一致性。
- `runs`、`ok`、`failed`、`cancelled`、`unknown`、`distinctSessions` 和 `argsVariants` 均为非负安全整数；要求 `ok + failed = runs`，会话/变体数不大于 runs，存在运行时二者都大于零。取消或未知 outcome 出现即 `unknown`：spec 并未定义将其纳入成功率分母的规则，不能猜。
- 必须由调用方提供安全整数 UTC epoch 毫秒 `lastUsedMs` 和 `nowMs`，不隐式取机器时钟；未来时间、缺失指标或不一致数据均 `unknown`。30 天按恰好 30×24 小时定义，包含边界。不同的统计时间范围、窗口完整性和时间信任均由调用方负责。
- 不读取或回显其他字段；不返回工作流名称、脚本、参数、会话标识或任何输入原文。合成输入也不能直接替代真实数据权限和隐私设计。

## 保守判定

先校验完整性和全部指标，再按以下顺序处理。成功率以整数计数精确比较（避免舍入）；任一数据问题都不是 `not-worth`。

| 条件 | verdict | 原因 |
|---|---|---|
| 不足 3 次 | `unknown` | 样本不足，本原型不臆断 |
| 3–4 次（含任何明确成功率） | `candidate` | 字面 3–4 次条件确定；promote 的 ≥5 次不成立 |
| ≥5 次、成功率 <70% | `not-worth` | 已知 candidate/promote 条件均不成立 |
| ≥5 次、70% ≤ 成功率 <90% | `candidate` | candidate 成立，promote 的 ≥90% 不成立 |
| ≥5 次、成功率恰为 90% | `unknown` | spec 的 70–90% 和 ≥90% 边界重叠，不自行裁决优先级 |
| ≥5 次、成功率 >90%，会话数 <2、参数变体 >3 或超过 30 天 | `not-worth` | 有已知 promote 前置条件不满足；candidate 范围之外 |
| ≥5 次、成功率 >90%，其他数值门槛均满足 | `unknown` | spec 未定义「失败不集中」的指标和阈值，无法判定 promote |

`unknown` 是此研究接口的**安全扩展**，spec 原版仅列 `promote`/`candidate`/`not-worth`；不可直接冒充 spec 的完整 API。尤其不把证据缺失或重叠规则压成肯定结论；本原型**不会输出 `promote`**。`candidate`/`not-worth` 是在以上全部 caller 断言成立和该保守解释下的条件建议，不是已验证的事实，也不是自动执行授权。

没有 `score`，因为 spec 未给计分公式；没有默认失败集中阈值、trend 或时长/token 估算。也未实现可配置阈值、真实聚合、可信来源适配、host 工具、Remote/授权、持久化、实际晋升以及 UI。接真实数据前必须先确定指标、成功率分母、完整性/稳定身份、重复运行和权限的可验证契约，明确 90% 重叠与失败集中规则，再单独确认对应披露通道。

## 测试

只用人工合成内存输入和 Node 自带测试，无需安装依赖：

```sh
node --test packages/workflow-recommendation/test/*.test.mjs
```

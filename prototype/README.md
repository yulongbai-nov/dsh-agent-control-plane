# 原型 / 设计 mock

> 2026-11-04 更新：视觉层方案已取消（只保留官方运行树 + workflow-lite 画布）。
> 这里的 mock 作为设计存档保留，不进入实现路线。

静态 HTML，无运行代码；用于确认交互与视觉后再决定实现方案。

- [`inline-workflow-card.html`](inline-workflow-card.html)：消息流内嵌工作流运行卡（折叠摘要 / 展开步骤 / 失败自动展开 / 跳画布）。
- [`dag-canvas.html`](dag-canvas.html)：画布同款 DAG 视图（phase 列自动布局、隐式/显式 phase 切换、运行/完成/失败动画、回边流动、资源节点、深浅色、重播）。
- [`dag-auto-layout.html`](dag-auto-layout.html)：DAG 自动布局（phase 泳道 + 拓扑 rank 排序 + 曼哈顿正交走线 + 平行边 track 偏移 + 交叉跨线桥）；可切自由布局/打乱，再一键飞回泳道。
- 截图与动图：`docs/evidence/2026-11-04/`。

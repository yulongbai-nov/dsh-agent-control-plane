## 改了什么

<!-- 一句话 + 关联 issue -->

## 验证

- [ ] `node third_party/dsh-session-tree/scripts/build.mjs --check`
- [ ] `node --test third_party/dsh-session-tree/tests/*.test.mjs`
- [ ] `cd e2e && node run-e2e.mjs --mock-model`（连续两次通过）
- [ ] 新增/修改的行为有 E2E 用例（或说明为何不需要）
- [ ] 没有真实模型调用、没有触碰 desktop profile / 用户会话

## 影响面

- [ ] 插件包结构 / manifest 变化（列出）
- [ ] 安装/回滚路径变化（列出并实测）
- [ ] 文档更新（README/DELIVERY/CHANGELOG）

## 证据

<!-- 通过日志、截图/GIF 路径（不要贴 token/密钥） -->

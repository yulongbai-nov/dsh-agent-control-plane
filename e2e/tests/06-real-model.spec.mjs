import { test, expect } from 'playwright/test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ART, REAL_MODEL, boot } from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

// Gated by `--real-model`: these two tests spend two cheap model calls.
test.describe('控制面 E2E · 真实模型层', () => {
  test('一条短消息收到真实回复并产生 token 统计（真实登录）', async ({ page }) => {
    test.skip(!REAL_MODEL, 'real-model tests disabled (pass --real-model)')
    await boot(page)
    const composer = page.locator('[role=textbox]').first()
    await composer.click()
    await page.keyboard.type('直接回答：1+1 等于几？只回复一个阿拉伯数字，不要调用任何工具。')
    await page.getByRole('button', { name: 'Send message' }).first().click()
    await expect(page.getByText(/Usage .*tok/).first()).toBeVisible({ timeout: 120_000 })
    await page.screenshot({ path: join(ART, '11-real-model-reply.png') })
  })

  test('团队插件把 spawn_teammate_with_model 暴露给 agent（R1/R6 面）', async ({ page }) => {
    test.skip(!REAL_MODEL, 'real-model tests disabled (pass --real-model)')
    await boot(page)
    const composer = page.locator('[role=textbox]').first()
    await composer.click()
    await page.keyboard.type(
      '只回答一个问题，不要调用任何工具：你的工具列表里是否有名为 spawn_teammate_with_model 的工具？' +
        '有就只回复 TOOL_YES，没有就只回复 TOOL_NO。',
    )
    await page.getByRole('button', { name: 'Send message' }).first().click()
    await expect(page.getByText(/TOOL_(YES|NO)/).first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText(/TOOL_YES/).first()).toBeVisible()
    await page.screenshot({ path: join(ART, '12-team-tool-visible.png') })
  })

  test('遥测插件把真实会话事件写进隔离目录（R18 面）', async () => {
    test.skip(!REAL_MODEL, 'real-model tests disabled (pass --real-model)')
    const root = process.env.DSH_E2E_ROOT || '/tmp/dsh-e2e'
    const bin = join(homedir(), '.dsh/profiles/e2e/node_modules/dsh-local-telemetry/bin/telemetry.mjs')
    const out = execFileSync(
      process.execPath,
      [bin, '--status', '--store', 'sqlite', '--path', join(root, 'state/telemetry')],
      { encoding: 'utf8', timeout: 30_000 },
    )
    // `written=` is the query process's own counter; the stored rows are the evidence.
    const rows = Number((out.match(/rows: (\d+)/) || [])[1] || 0)
    expect(rows, `telemetry status:\n${out}`).toBeGreaterThan(0)
  })
})

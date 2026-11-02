import { test, expect } from 'playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ART, unexpectedErrors, boot, captureConsole } from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

test.describe('控制面 E2E · 应用外壳', () => {
  test('打开应用后侧栏显示会话树（R7 常驻侧栏）', async ({ page }) => {
    await boot(page)
    // The control-plane session tree occupies the sidebar's workspace slot.
    await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Filter sessions…' })).toBeVisible()
    // At least one workspace group and one session row are rendered from real Host data.
    await expect(page.getByRole('treeitem').first()).toBeVisible()
    await page.screenshot({ path: join(ART, '01-sidebar-session-tree.png') })
  })

  test('点击新建会话，主面板出现新会话界面', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'New session' }).first().click()
    await expect(page.locator('[role=textbox]').first()).toBeVisible()
    await expect(page.getByText(/Describe what you want to build/).first()).toBeVisible()
    await page.screenshot({ path: join(ART, '02-new-session.png') })
  })

  test('页面没有未捕获的 JS 错误', async ({ page }) => {
    const { consoleErrors, pageErrors } = captureConsole(page)
    await boot(page)
    await page.waitForTimeout(1500)
    const unexpected = unexpectedErrors([...pageErrors, ...consoleErrors])
    writeFileSync(
      join(ART, 'console-errors.json'),
      JSON.stringify({ pageErrors, consoleErrors, knownBenign: consoleErrors.filter((e) => !unexpected.includes(e)) }, null, 2),
    )
    expect(pageErrors, `uncaught page errors: ${JSON.stringify(pageErrors)}`).toEqual([])
    expect(unexpected, `unexpected console errors: ${JSON.stringify(unexpected)}`).toEqual([])
    await page.screenshot({ path: join(ART, '03-no-js-errors.png') })
  })
})

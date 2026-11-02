import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot } from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

test.describe('控制面 E2E · 工作流地图（R10/R11）', () => {
  test('侧栏出现「工作流地图」入口，打开后应用不崩溃且可返回会话', async ({ page }) => {
    await boot(page)
    const entry = page.getByRole('button', { name: '工作流地图' }).first()
    await expect(entry).toBeVisible()
    await entry.click()
    await page.waitForTimeout(1500)
    // The plugin panel occupies the main area; the sidebar tree must keep working.
    await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: join(ART, '10-workflow-map.png') })
    // Return to the conversation surface through a real tree row click.
    await page.locator('[role=treeitem][data-kind="session"]').first().click()
    await page.waitForTimeout(800)
    await expect(page.locator('[role=textbox]').first()).toBeVisible()
  })
})

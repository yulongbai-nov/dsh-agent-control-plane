import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot } from './helpers.mjs'

const INSTALLED = [
  'Session Tree',
  'dsh-agent-teams-model-override',
  'dshmarket',
  'dsh-local-telemetry',
  'Workflow Map',
]

test.describe.configure({ mode: 'serial' })

test.describe('控制面 E2E · 插件装载与市场（R13）', () => {
  test('Plugins 页面列出控制面全部已装插件', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Plugins' }).first().click()
    await expect(page.getByText('Installed plugins')).toBeVisible()
    for (const name of INSTALLED) {
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible()
    }
    await page.screenshot({ path: join(ART, '08-plugins-page.png'), fullPage: true })
  })

  test('插件市场（dshmarket）在 Plugins 页提供 Plugin Market 入口', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Plugins' }).first().click()
    await expect(page.getByText('Plugin Market').first()).toBeVisible()
    await page.getByText('Plugin Market').first().click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(ART, '09-plugin-market.png') })
  })
})

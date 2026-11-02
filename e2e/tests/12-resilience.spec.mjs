import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot, sessionRows, openRowMenu, captureConsole, unexpectedErrors } from './helpers.mjs'

/**
 * Layout / interaction resilience edge cases:
 *  - the app must stay usable at a narrow viewport (collapsed sidebar rail → expand);
 *  - hammering the row menu and the filter must not leave the UI stuck or leak errors.
 */
test.describe.configure({ mode: 'serial' })

test.describe('控制面 E2E · 布局与交互韧性', () => {
  test('窄视口（900×700）下侧栏可展开、树与行菜单仍可用', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await boot(page)
    await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible()
    const row = sessionRows(page).first()
    await expect(row).toBeVisible()
    await openRowMenu(page, row)
    await expect(page.getByRole('menu')).toBeVisible()
    await page.screenshot({ path: join(ART, '23-narrow-viewport-menu.png') })
    // Each test gets a fresh page; just restore the default viewport for the next one.
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('连续开关行菜单 + 反复筛选 20 轮后 UI 未卡死', async ({ page }) => {
    const { pageErrors, consoleErrors } = captureConsole(page)
    await boot(page)
    const rowActions = page.locator('button[aria-label="Row actions"]').first()
    await expect(rowActions).toBeVisible()
    await rowActions.focus()

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menu')).toHaveCount(0)
    }

    const filter = page.getByRole('textbox', { name: 'Filter sessions…' })
    for (let i = 0; i < 5; i++) {
      await filter.fill('zzz-none')
      await expect.poll(async () => sessionRows(page).count()).toBe(0)
      await filter.fill('')
      await expect.poll(async () => sessionRows(page).count()).toBeGreaterThan(0)
    }

    await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible()
    await expect(page.locator('[role=textbox]').first()).toBeVisible()
    expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toEqual([])
    expect(unexpectedErrors(consoleErrors), 'no unexpected console errors').toEqual([])
    await page.screenshot({ path: join(ART, '24-interaction-hammering.png') })
  })
})

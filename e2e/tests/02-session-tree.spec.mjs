import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot, sessionRows, openRowMenu } from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

test.describe('控制面 E2E · 侧栏会话树', () => {
  test('工作区分组可展开/折叠，会话行来自真实 Host 数据', async ({ page }) => {
    await boot(page)
    const group = page.locator('[role=treeitem][data-kind="workspace"]').first()
    await expect(group).toBeVisible()
    // The tree starts expanded; collapsing hides the session rows, expanding restores them.
    const before = await sessionRows(page).count()
    expect(before).toBeGreaterThan(0)
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('textbox', { name: 'Filter sessions…' })).toBeVisible()
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await expect(sessionRows(page).first()).toBeVisible()
    await page.screenshot({ path: join(ART, '04-session-tree-expanded.png') })
  })

  test('筛选框按标题过滤会话', async ({ page }) => {
    await boot(page)
    const filter = page.getByRole('textbox', { name: 'Filter sessions…' })
    await filter.fill('zzz-no-such-session')
    await page.waitForTimeout(500)
    expect(await sessionRows(page).count()).toBe(0)
    await filter.fill('')
    await expect(sessionRows(page).first()).toBeVisible()
  })

  test('会话行「⋯」菜单提供置顶/重命名/Fork/归档与头像入口（R8）', async ({ page }) => {
    await boot(page)
    const row = sessionRows(page).first()
    await openRowMenu(page, row)
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitemradio')).toHaveCount(7) // 6 avatar types + auto-detect
    await expect(menu.getByRole('menuitem', { name: 'Pin' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Archive' })).toBeVisible()
    await page.screenshot({ path: join(ART, '05-row-menu.png') })
  })
})

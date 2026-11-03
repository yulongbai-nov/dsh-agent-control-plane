import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot, sessionRows, openRowMenu } from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

test.describe('控制面 E2E · 六类任务头像（R8）', () => {
  test('每个会话行渲染角色头像，并带三套变体之一', async ({ page }) => {
    await boot(page)
    const row = sessionRows(page).first()
    const avatar = row.locator('img.st-avatar')
    await expect(avatar).toBeVisible()
    const type = await avatar.getAttribute('data-avatar-type')
    const variant = await avatar.getAttribute('data-avatar-variant')
    expect(['lead', 'research', 'code', 'write', 'data', 'qa']).toContain(type)
    expect(['a', 'b', 'c']).toContain(variant)

    // Different sessions pick different art variants (deterministic per session id),
    // so a long tree is not visually monotonous.
    const variants = await sessionRows(page).locator('img.st-avatar').evaluateAll((imgs) =>
      [...new Set(imgs.map((img) => img.getAttribute('data-avatar-variant')))],
    )
    const rows = await sessionRows(page).count()
    if (rows >= 3) expect(variants.length).toBeGreaterThanOrEqual(2)
    await page.screenshot({ path: join(ART, '06-avatars.png') })
  })

  test('手动指定头像后刷新仍保留（类型与变体都稳定），并可恢复自动识别', async ({ page }) => {
    await boot(page)
    const row = sessionRows(page).first()
    const variantBefore = await row.locator('img.st-avatar').getAttribute('data-avatar-variant')
    await openRowMenu(page, row)
    await page.getByRole('menuitemradio', { name: 'Development' }).click()
    await expect(page.locator('img.st-avatar').first()).toHaveAttribute('data-avatar-type', 'code')
    await page.screenshot({ path: join(ART, '07-avatar-manual.png') })

    // Reload: the manual override is stored per session id in localStorage.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible({ timeout: 45_000 })
    await expect(page.locator('[role=treeitem][data-kind="session"] img.st-avatar').first()).toHaveAttribute(
      'data-avatar-type',
      'code',
    )
    // variant stays deterministic across reload for the same session
    await expect(page.locator('[role=treeitem][data-kind="session"] img.st-avatar').first()).toHaveAttribute(
      'data-avatar-variant',
      variantBefore,
    )

    // Reset back to automatic detection.
    const rowAfter = sessionRows(page).first()
    await openRowMenu(page, rowAfter)
    await page.getByRole('menuitemradio', { name: 'Auto-detect' }).click()
    await expect(page.locator('[role=treeitem][data-kind="session"] img.st-avatar').first()).toHaveAttribute(
      'data-avatar-type',
      'lead',
    )
  })
})

import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot, newSession, sessionRows, openRowMenu, captureConsole, unexpectedErrors } from './helpers.mjs'

/**
 * Edge cases for the sidebar session tree (R7/R8 UI semantics):
 *  - rename / pin / archive / show-archived round trip on real Host state;
 *  - filter input with regex/emoji characters must never crash;
 *  - rapid expand/collapse hammering keeps the tree consistent;
 *  - a very long title is truncated in the row, not overflowing the sidebar.
 */
test.describe.configure({ mode: 'serial' })

const labelOf = async (row) => (await row.locator('.st-label').innerText()).trim()

test.describe('控制面 E2E · 会话树边界', () => {
  test('重命名 → 置顶 → 归档 → 显示已归档 → 取消归档（真实 Host 状态往返）', async ({ page }) => {
    await boot(page)
    const firstRow = sessionRows(page).first()
    const originalLabel = await labelOf(firstRow)
    const renamed = `边界重命名-${Date.now().toString().slice(-6)}`

    // rename
    await openRowMenu(page, firstRow)
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const input = page.locator('input.st-rename').first()
    await expect(input).toBeVisible()
    await input.fill(renamed)
    await input.press('Enter')
    await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible()

    // pin: the pinned row leads the list
    const renamedRow = sessionRows(page).filter({ hasText: renamed }).first()
    await openRowMenu(page, renamedRow)
    await page.getByRole('menuitem', { name: 'Pin' }).click()
    await expect(sessionRows(page).first()).toContainText(renamed)

    // archive: hidden from the default view
    await openRowMenu(page, renamedRow)
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0)

    // show archived -> visible again
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitemradio', { name: 'Show archived' }).click()
    await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: join(ART, '23-tree-archived-shown.png') })

    // unarchive -> back to normal state (and hide archived again)
    const archivedRow = sessionRows(page).filter({ hasText: renamed }).first()
    await openRowMenu(page, archivedRow)
    await page.getByRole('menuitem', { name: 'Unarchive' }).click()
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitemradio', { name: 'Hide archived' }).click()
    await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible()
    // restore the original label so later tests see a stable tree
    const finalRow = sessionRows(page).filter({ hasText: renamed }).first()
    await openRowMenu(page, finalRow)
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const restore = page.locator('input.st-rename').first()
    await restore.fill(originalLabel)
    await restore.press('Enter')
    await expect(page.getByText(originalLabel, { exact: true }).first()).toBeVisible()
    // Unpin so later specs see the default ordering again.
    const restoredRow = sessionRows(page).filter({ hasText: originalLabel }).first()
    await openRowMenu(page, restoredRow)
    const unpin = page.getByRole('menuitem', { name: 'Unpin' })
    if (await unpin.count()) await unpin.click()
    else await page.keyboard.press('Escape')
  })

  test('筛选框接受正则/emoji 等特殊字符且不崩溃', async ({ page }) => {
    const { pageErrors, consoleErrors } = captureConsole(page)
    await boot(page)
    const filter = page.getByRole('textbox', { name: 'Filter sessions…' })
    const before = await sessionRows(page).count()
    expect(before).toBeGreaterThan(0)

    for (const query of ['*[](){}|^$\\.', '😀🦀', '<script>alert(1)</script>', 'a'.repeat(120)]) {
      await filter.fill(query)
      await page.waitForTimeout(200)
      expect(await sessionRows(page).count()).toBeGreaterThanOrEqual(0)
      await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible()
    }
    await filter.fill('')
    await expect(sessionRows(page).first()).toBeVisible()
    expect(pageErrors).toEqual([])
    expect(unexpectedErrors(consoleErrors)).toEqual([])
  })

  test('快速连续展开/折叠 15 次，树状态与 ARIA 保持一致且无异常', async ({ page }) => {
    const { pageErrors } = captureConsole(page)
    await boot(page)
    const group = page.locator('[role=treeitem][data-kind="workspace"]').first()
    await expect(group).toBeVisible()
    for (let i = 0; i < 15; i++) {
      await group.click({ delay: 10 })
    }
    await page.waitForTimeout(400)
    const expanded = await group.getAttribute('aria-expanded')
    expect(['true', 'false']).toContain(expanded)
    await expect(page.getByRole('button', { name: 'New session' }).first()).toBeVisible()
    await page.screenshot({ path: join(ART, '24-tree-rapid-toggle.png') })
    expect(pageErrors).toEqual([])
  })

  test('超长标题在会话行内被截断，不撑破侧栏', async ({ page }) => {
    // Mock-only: the reply assertion is the deterministic mock text, and a real-model
    // lane should not spend a call just to test CSS truncation.
    test.skip(process.env.DSH_E2E_MOCK_MODEL !== '1', 'needs the mock model layer')
    await boot(page)
    await newSession(page)
    const longText = `超长标题边界-${'很长很长的任务描述'.repeat(12)}-END`
    const composer = page.locator('[role=textbox]').first()
    await composer.click()
    await page.keyboard.type(longText)
    await page.getByRole('button', { name: 'Send message' }).first().click()
    await expect(page.getByText(/MOCK_OK:/).first()).toBeVisible({ timeout: 120_000 })

    const row = sessionRows(page).first()
    await expect(row).toBeVisible()
    const metrics = await row.locator('.st-label').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflow: getComputedStyle(el).overflow,
      textOverflow: getComputedStyle(el).textOverflow,
      sidebarWidth: el.closest('[role=tree]')?.getBoundingClientRect().width ?? 0,
    }))
    // Overflow is clipped (ellipsis) or the label is simply shorter than the row.
    expect(metrics.scrollWidth >= metrics.clientWidth).toBe(true)
    expect(metrics.overflow === 'hidden' || metrics.scrollWidth < metrics.clientWidth).toBe(true)
    expect(metrics.sidebarWidth).toBeLessThan(600)
    await page.screenshot({ path: join(ART, '25-tree-long-title.png') })
  })
})

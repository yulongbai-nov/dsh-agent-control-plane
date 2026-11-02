import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot, captureConsole, unexpectedErrors, openSettingsGeneral, closeSettings, selectTheme, selectLanguage } from './helpers.mjs'

/**
 * R17 视觉 / 无障碍（真机 GUI，无模型调用）：
 *  - 深色 / 浅色主题切换（真实 Settings → Appearance），会话树在两种主题下都可见、不崩溃；
 *  - 中 / 英 locale 切换（真实 Settings → Language），侧栏文案随之变化；
 *  - 键盘可达性：Enter 能激活侧栏「新建会话」，Tab 能进入会话树并 Enter 打开行菜单。
 *
 * 真实 GUI 事实（探针确认）：
 *  - Settings 快捷键：web:macos = Meta+Alt+Comma（desktop:macos 才是 Cmd+,）；
 *  - 深色主题：<html data-ds-theme-source="dark"> + <body data-ds-dark-theme> + style.colorScheme=dark；
 *  - Language 行是按钮（"English"），点击后弹出 role=menu（menuitem: 中文 / English）；
 *  - 会话树行是 div[role=treeitem] 且 tabindex=-1（方向键/行焦点导航未实现，见测试内断言），
 *    但树内「Row actions」按钮可 Tab 聚焦、Enter 可打开行菜单。
 */

test.describe.configure({ mode: 'serial' })

const DEFAULTS = { theme: 'light', language: 'English' }

// 让每个用例从确定的状态开始：浅色 + English（防止上一个用例失败留下深色/中文）。
test.afterEach(async ({ page }) => {
  try {
    if (page.isClosed()) return
    // 关闭可能残留的菜单/弹窗，避免下一步被遮挡
    for (let i = 0; i < 3; i++) {
      const dialogs = await page.locator('[role=dialog]').count().catch(() => 0)
      if (!dialogs) break
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    const lang = await page.evaluate(() => document.documentElement.lang)
    if (!/^en/i.test(lang)) await selectLanguage(page, 'English')
    await selectTheme(page, false)
  } catch (error) {
    console.log('[R17] afterEach reset skipped:', String(error).slice(0, 300))
  }
})

test.describe('控制面 E2E · R17 视觉与无障碍', () => {
  test('深色主题下侧栏会话树仍可见、无崩溃（切回浅色）', async ({ page }) => {
    const { pageErrors, consoleErrors } = captureConsole(page)
    await boot(page)
    const tree = page.locator('[role=tree]')
    await expect(tree).toBeVisible()
    const itemCountBefore = await page.locator('[role=treeitem]').count()

    const dialog = await openSettingsGeneral(page)
    const before = await page.evaluate(() => ({ source: document.documentElement.getAttribute('data-ds-theme-source'), dark: document.body.hasAttribute('data-ds-dark-theme') }))
    console.log('[R17] theme before:', JSON.stringify(before))
    await dialog.locator('button', { hasText: /^(Dark|深色)$/ }).first().click()

    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ds-theme-source')), { timeout: 10_000 })
      .toBe('dark')
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark')
    await closeSettings(page)

    // 深色下侧栏会话树与真实会话数据仍渲染
    await expect(tree).toBeVisible()
    await expect(page.locator('[role=treeitem]')).toHaveCount(itemCountBefore)
    await page.screenshot({ path: join(ART, '14-r17-theme-dark.png') })

    // 切回浅色并复核
    await selectTheme(page, false)
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ds-theme-source'))).toBe('light')
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(false)
    await expect(tree).toBeVisible()
    await page.screenshot({ path: join(ART, '15-r17-theme-light.png') })

    const unexpected = unexpectedErrors([...pageErrors, ...consoleErrors])
    expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toEqual([])
    expect(unexpected, `unexpected console errors: ${JSON.stringify(unexpected)}`).toEqual([])
  })

  test('中英 locale 切换后侧栏文案随之变化（切回英文）', async ({ page }) => {
    await boot(page)
    // 基线：英文界面（筛选框在侧栏里、role=tree 容器之外）
    expect(await page.evaluate(() => document.documentElement.lang)).toMatch(/^en/)
    const filterEn = page.getByRole('textbox', { name: 'Filter sessions…' })
    await expect(filterEn).toBeVisible()
    await expect(page.getByRole('button', { name: 'New session' }).first()).toBeVisible()

    await selectLanguage(page, '中文')

    await expect.poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 10_000 }).toMatch(/^zh/)
    await expect(page.getByRole('button', { name: '新建会话' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('textbox', { name: '筛选会话…' })).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: join(ART, '16-r17-locale-zh.png') })

    // 切回英文并复核（Settings 导航此时也是中文「通用」）
    await selectLanguage(page, 'English')
    await expect.poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 10_000 }).toMatch(/^en/)
    await expect(page.getByRole('button', { name: 'New session' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('textbox', { name: 'Filter sessions…' })).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: join(ART, '17-r17-locale-en.png') })
  })

  test('键盘：Enter 激活新建会话、Tab 进入会话树、Enter 打开行菜单', async ({ page }) => {
    const { pageErrors, consoleErrors } = captureConsole(page)
    await boot(page)

    // 1) 聚焦侧栏「新建会话」按钮并用 Enter 激活 → 主面板出现输入区
    const newSession = page.getByRole('button', { name: /^(New session|新建会话)$/ }).first()
    await newSession.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[role=textbox]').first()).toBeVisible({ timeout: 15_000 })

    // 2) Tab 能把焦点带进侧栏会话树内部（树行本身 tabindex=-1，但有可聚焦的行内控件）
    let focusedInTree = false
    let focusedLabel = null
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const state = await page.evaluate(() => {
        const el = document.activeElement
        return {
          inTree: Boolean(el && el.closest && el.closest('[role=tree]')),
          label: el?.getAttribute?.('aria-label') || (el?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        }
      })
      if (state.inTree) {
        focusedInTree = true
        focusedLabel = state.label
        break
      }
    }
    expect(focusedInTree, '连续 Tab 应能把键盘焦点带进会话树内的可交互控件').toBe(true)
    console.log('[R17] keyboard focus entered tree at:', focusedLabel)

    // 3) 聚焦首行「Row actions」并按 Enter 打开行菜单（真实键盘激活）
    const rowActions = page.locator('[role=tree] button[aria-label="Row actions"]').first()
    await expect(rowActions).toBeVisible()
    await rowActions.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 })
    expect(await page.getByRole('menu').getByRole('menuitem').count()).toBeGreaterThan(0)
    await page.screenshot({ path: join(ART, '18-r17-keyboard-row-menu.png') })
    // The plugin's row menu closes on outside click / toggle, not on Escape (real GUI
    // fact). Close it the way a keyboard user can: Enter on the same button toggles it.
    await page.keyboard.press('Escape')
    if (await page.getByRole('menu').count()) await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 10_000 })

    // 4) 记录真实 GUI 缺口：树行与树容器都不可键盘聚焦（方向键展开/行走未实现）
    const focusFacts = await page.evaluate(() => ({
      treeTabIndex: document.querySelector('[role=tree]')?.tabIndex,
      firstRowTabIndex: document.querySelector('[role=treeitem]')?.tabIndex,
      rowCount: document.querySelectorAll('[role=treeitem]').length,
    }))
    console.log('[R17] session tree focus facts (gap):', JSON.stringify(focusFacts))
    expect(focusFacts.treeTabIndex).toBe(-1)
    expect(focusFacts.firstRowTabIndex).toBe(-1)

    const unexpected = unexpectedErrors([...pageErrors, ...consoleErrors])
    expect(unexpected, `unexpected console errors: ${JSON.stringify(unexpected)}`).toEqual([])
  })
})

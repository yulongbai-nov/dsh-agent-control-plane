import { expect } from 'playwright/test'

export const APP_URL = process.env.DSH_E2E_URL
export const ART = process.env.DSH_E2E_ARTIFACTS || '/tmp/dsh-e2e/artifacts/latest'
export const REAL_MODEL = process.env.DSH_E2E_REAL_MODEL === '1'

// The web profile has no desktop account platform; this one line is expected and
// harmless (a real model reply renders fine with it present).
export const KNOWN_CONSOLE_ERRORS = [/\[deepseek-account\] account read failed/]
export const unexpectedErrors = (errors) => errors.filter((e) => !KNOWN_CONSOLE_ERRORS.some((re) => re.test(e)))

const isEnglish = async (page) =>
  page
    .evaluate(() => document.documentElement.lang)
    .then((lang) => /^en/i.test(lang || ''))
    .catch(() => true)

/** Settings modal (General tab). Shortcut differs per platform; account menu is the fallback. */
export async function openSettingsGeneral(page) {
  const shortcut = process.platform === 'darwin' ? 'Meta+Alt+Comma' : 'Control+Alt+Comma'
  await page.keyboard.press(shortcut)
  await page.waitForTimeout(1000)
  const dialog = page.getByRole('dialog')
  if ((await dialog.count()) === 0 || !(await dialog.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Account menu|账户菜单/ }).first().click()
    const settingsItem = page.getByRole('menuitem', { name: /^(Settings|设置|Preferences|偏好)$/ }).first()
    if (await settingsItem.count()) await settingsItem.click()
    else throw new Error('settings dialog did not open via shortcut or account menu')
  }
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  const general = dialog.getByRole('button', { name: /^(General|通用设置|通用|常规)$/ })
  if (await general.count()) await general.first().click()
  await expect(
    dialog.locator('button', { hasText: /^(Light|浅色|Dark|深色|System|跟随系统)$/ }).first(),
  ).toBeVisible({ timeout: 15_000 })
  return dialog
}

export async function closeSettings(page) {
  const dialog = page.locator('[role=dialog]')
  if ((await dialog.count()) === 0) return
  const close = dialog.locator('button[aria-label="Close"], button[aria-label="关闭"]').first()
  if (await close.count()) await close.click().catch(() => {})
  else await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0, { timeout: 10_000 }).catch(() => {})
}

export async function selectTheme(page, dark) {
  const dialog = await openSettingsGeneral(page)
  const label = dark ? /^(Dark|深色)$/ : /^(Light|浅色)$/
  await dialog.locator('button', { hasText: label }).first().click()
  await page.waitForTimeout(400)
  await closeSettings(page)
}

/** Switch UI language. `target` is 'English' or '中文'; tolerant of localized option labels. */
export async function selectLanguage(page, target) {
  const dialog = await openSettingsGeneral(page)
  const languageButton = dialog.locator('button', { hasText: /^(English|英文|中文|简体中文)$/ }).first()
  await languageButton.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible({ timeout: 10_000 })
  const items = menu.getByRole('menuitem')
  const wanted = target === 'English' ? /english|英文/i : /中文|chinese/i
  let clicked = false
  const count = await items.count()
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).innerText().catch(() => '')
    if (wanted.test(text)) {
      await items.nth(i).click()
      clicked = true
      break
    }
  }
  if (!clicked) throw new Error(`language option "${target}" not found; menu=${await menu.innerText().catch(() => '')}`)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 15_000 })
    .toMatch(target === 'English' ? /^en/i : /^zh/i)
  await page.waitForTimeout(300)
  await closeSettings(page)
}

/** Recover to the English UI if a previous test left another locale persisted. */
export async function ensureEnglish(page) {
  if (await isEnglish(page)) return
  try {
    await selectLanguage(page, 'English')
  } catch (error) {
    console.log('[helpers] ensureEnglish failed:', String(error).slice(0, 200))
  }
}

/** Load the authenticated app URL, dismiss first-run dialogs, ensure a usable English shell. */
export async function boot(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  // At narrow viewports (or after a previous test collapsed it) the sidebar opens
  // as an icon rail; expand it so the session tree is reachable.
  const expand = page.getByRole('button', { name: /Expand sidebar|打开侧边栏|展开侧边栏/ })
  if ((await expand.count()) && (await expand.first().isVisible())) {
    await expand.first().click()
    await page.waitForTimeout(500)
  }
  await expect(page.getByText(/^(Sessions|Workspaces|会话树|工作区)$/).first()).toBeVisible({ timeout: 45_000 })
  for (let i = 0; i < 4; i++) {
    const cont = page.getByRole('button', { name: /^(Continue|继续)$/ })
    if ((await cont.count()) && (await cont.first().isVisible())) {
      await cont.first().click()
      await page.waitForTimeout(800)
      continue
    }
    const close = page.locator('[role=dialog] button[aria-label="Close"], [role=dialog] button[aria-label="关闭"]')
    if ((await close.count()) && (await close.first().isVisible())) {
      await close.first().click()
      await page.waitForTimeout(800)
      continue
    }
    break
  }
  await ensureEnglish(page)
}

/** Session rows rendered by the control-plane session tree. */
export const sessionRows = (page) =>
  page.locator('[role=treeitem][data-kind="session"], [role=treeitem][data-kind="subagent"]')

/** Start a fresh conversation so a previously failed turn cannot leak into a test. */
export async function newSession(page) {
  await page.getByRole('button', { name: /^(New session|新建会话)$/ }).first().click()
  await expect(page.locator('[role=textbox]').first()).toBeVisible({ timeout: 20_000 })
}

/** Close an open row menu (Escape is not wired in the plugin; the toggle is). */
export async function closeRowMenu(page) {
  if ((await page.getByRole('menu').count()) === 0) return
  await page.locator('button[aria-label="Row actions"]').first().click()
  await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 10_000 })
}

/** Open the per-row "…" menu of one session row. */
export async function openRowMenu(page, row) {
  await row.getByRole('button', { name: 'Row actions' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

/** Collect console errors and uncaught page errors for one test. */
export function captureConsole(page) {
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  return { consoleErrors, pageErrors }
}

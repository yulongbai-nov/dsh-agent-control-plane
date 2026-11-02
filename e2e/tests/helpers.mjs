import { expect } from 'playwright/test'

export const APP_URL = process.env.DSH_E2E_URL
export const ART = process.env.DSH_E2E_ARTIFACTS || '/tmp/dsh-e2e/artifacts/latest'
export const REAL_MODEL = process.env.DSH_E2E_REAL_MODEL === '1'

// The web profile has no desktop account platform; this one line is expected and
// harmless (a real model reply renders fine with it present).
export const KNOWN_CONSOLE_ERRORS = [/\[deepseek-account\] account read failed/]
export const unexpectedErrors = (errors) => errors.filter((e) => !KNOWN_CONSOLE_ERRORS.some((re) => re.test(e)))

/** Load the authenticated app URL and dismiss the first-run dialogs. */
export async function boot(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(/^(Sessions|Workspaces)$/).first()).toBeVisible({ timeout: 45_000 })
  for (let i = 0; i < 4; i++) {
    const cont = page.getByRole('button', { name: /^Continue$/ })
    if ((await cont.count()) && (await cont.first().isVisible())) {
      await cont.first().click()
      await page.waitForTimeout(800)
      continue
    }
    const close = page.locator('[role=dialog] button[aria-label="Close"]')
    if ((await close.count()) && (await close.first().isVisible())) {
      await close.first().click()
      await page.waitForTimeout(800)
      continue
    }
    break
  }
}

/** Session rows rendered by the control-plane session tree. */
export const sessionRows = (page) => page.locator('[role=treeitem][data-kind="session"], [role=treeitem][data-kind="subagent"]')

/** Open the per-row "…" menu of one session row. */
export async function openRowMenu(page, row) {
  await row.getByRole('button', { name: 'Row actions' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

export function captureConsole(page) {
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  return { consoleErrors, pageErrors }
}

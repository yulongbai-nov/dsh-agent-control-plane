import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot, newSession, captureConsole, unexpectedErrors } from './helpers.mjs'

/**
 * Edge cases: the model layer fails and the product must show a readable error,
 * stay usable, and recover on the same running instance.
 *
 * Driven through the official Messages mock's control plane (`DSH_E2E_MOCK_CONTROL`),
 * so each test scripts the exact wire behavior the next request receives — no real
 * model calls and no custom mock implementation.
 */
const CONTROL = process.env.DSH_E2E_MOCK_CONTROL
const MOCK = process.env.DSH_E2E_MOCK_MODEL === '1'
// The control plane can script faults, but restarting the mock mid-run perturbs the
// long-lived Host connection; keep these as an explicit opt-in run.
const FAULTS = process.env.DSH_E2E_MOCK_FAULTS === '1'

const setSequence = async (sequence) => {
  const response = await fetch(`${CONTROL}/sequence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sequence }),
  })
  expect(response.ok, `mock control /sequence failed: ${response.status}`).toBe(true)
}

const sendPrompt = async (page, text) => {
  const composer = page.locator('[role=textbox]').first()
  await composer.click()
  await page.keyboard.type(text)
  await page.getByRole('button', { name: 'Send message' }).first().click()
}

test.describe.configure({ mode: 'serial' })

test.describe('控制面 E2E · 模型故障边界', () => {
  test.skip(!FAULTS || !MOCK || !CONTROL, 'opt-in: DSH_E2E_MOCK_FAULTS=1 with --mock-model')

  test.afterEach(async () => {
    if (CONTROL) await setSequence(['success']).catch(() => {})
  })

  test('429 限流：重试耗尽后 UI 显示错误状态且不崩溃', async ({ page }) => {
    const { pageErrors, consoleErrors } = captureConsole(page)
    await setSequence(['rate_limit'])
    await boot(page)
    await newSession(page)
    await sendPrompt(page, '触发一次限流边界：MOCK_FAULT_429')

    // The real Host retries per its llm-retry policy, then surfaces the provider error.
    await expect(page.getByText(/rate.?limit|429|quota|too many requests|限流/i).first()).toBeVisible({
      timeout: 120_000,
    })
    await page.screenshot({ path: join(ART, '20-fault-rate-limit.png') })

    await expect(page.locator('[role=textbox]').first()).toBeVisible()
    await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible()
    expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toEqual([])
    expect(unexpectedErrors(consoleErrors), 'no unexpected console errors').toEqual([])
  })

  test('500 服务错误：错误可读，同一实例换新会话后可恢复', async ({ page }) => {
    await setSequence(['server_error'])
    await boot(page)
    await newSession(page)
    await sendPrompt(page, '触发一次 500 边界：MOCK_FAULT_500')
    await expect(page.getByText(/server.?error|500|internal error|服务/i).first()).toBeVisible({ timeout: 120_000 })
    await page.screenshot({ path: join(ART, '21-fault-server-error.png') })

    // Recovery on the same running instance: reset the mock, start a fresh session.
    await setSequence(['success'])
    await newSession(page)
    await sendPrompt(page, '恢复后继续：MOCK_FAULT_RECOVER')
    await expect(page.getByText(/MOCK_OK:/).first()).toBeVisible({ timeout: 120_000 })
    await page.screenshot({ path: join(ART, '22-fault-recovered.png') })
  })
})

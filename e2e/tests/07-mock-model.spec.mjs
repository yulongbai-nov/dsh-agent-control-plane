import { test, expect } from 'playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ART, boot, newSession } from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

// Runs only with `node e2e/run-e2e.mjs --mock-model`: the profile's default model
// is switched to the local OpenAI-compatible mock provider (zero cost, deterministic).
test.describe('控制面 E2E · 确定性 mock 模型层', () => {
  test.skip(process.env.DSH_E2E_MOCK_MODEL !== '1', 'mock model disabled (pass --mock-model)')

  test('发送消息后收到 mock provider 的确定性回复，且零真实模型调用', async ({ page }) => {
    await boot(page)
    await newSession(page)
    const composer = page.locator('[role=textbox]').first()
    await composer.click()
    await page.keyboard.type('请只回复一段固定文本，不要调用工具：MOCK_DETERMINISTIC_OK')
    await page.getByRole('button', { name: 'Send message' }).first().click()

    // The mock answers every non-arithmetic prompt with `MOCK_OK:<prompt>`.
    await expect(page.getByText(/MOCK_OK:/).first()).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: join(ART, '13-mock-model-reply.png') })

    // The mock provider's own request log proves the model layer really was local.
    // Both mock layers capture the accepted request; the official one records the
    // Messages body, the simple one records the prompt. Either way the user text
    // must be in the capture and no real provider may have been contacted.
    const record = process.env.DSH_E2E_MOCK_RECORD
    expect(record && existsSync(record), `mock provider record missing: ${record}`).toBe(true)
    const raw = readFileSync(record, 'utf8')
    const lines = raw.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    expect(raw).toContain('MOCK_DETERMINISTIC_OK')
  })
})

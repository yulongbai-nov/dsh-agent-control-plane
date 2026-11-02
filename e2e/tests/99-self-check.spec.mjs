import { test, expect } from 'playwright/test'
import { boot } from './helpers.mjs'

/**
 * Evidence pipeline self-check.
 *
 * Only active when DSH_E2E_SELF_FAIL=1: it deliberately fails so the
 * failure-evidence reporter (screenshot + video + GIF + trace) has something
 * real to collect. Normal runs skip it, so the suite stays green.
 */
const SELF_FAIL = process.env.DSH_E2E_SELF_FAIL === '1'

test.describe('控制面 E2E · 取证自检', () => {
  test('故意失败：验证失败取证链路（截图/视频/GIF/trace）', async ({ page }) => {
    test.skip(!SELF_FAIL, 'self-check disabled (set DSH_E2E_SELF_FAIL=1 to run the deliberate failure)')
    await boot(page)
    await page.waitForTimeout(1200) // let the screen recording capture a few frames
    expect(
      'self-check evidence',
      'DSH_E2E_SELF_FAIL=1：这是故意失败，用来证明失败截图/视频/GIF/trace 取证链路可用',
    ).toBe('expected-to-fail')
  })
})

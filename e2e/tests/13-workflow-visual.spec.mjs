import { test, expect } from 'playwright/test'
import { join } from 'node:path'
import { ART, boot, newSession, REAL_MODEL } from './helpers.mjs'

/**
 * R10/R11 视觉：工作流地图不是"入口存在"就算通过，必须真的渲染出分步流程。
 *  - mock 模型（默认，CI）：两轮消息 → Main flow / N steps / 节点卡；
 *  - 真实模型（可选）：模型真的跑一条 bash 工具 → 地图出现 tools/files 计数。
 */
const MOCK = process.env.DSH_E2E_MOCK_MODEL === '1'

const send = async (page, text) => {
  const composer = page.locator('[role=textbox]').first()
  await composer.click()
  await page.keyboard.type(text)
  await page.getByRole('button', { name: 'Send message' }).first().click()
}

const openWorkflowMap = async (page) => {
  await page.getByRole('button', { name: /工作流地图|Workflow Map/i }).first().click()
  await expect(page.getByText(/Main flow/i).first()).toBeVisible({ timeout: 30_000 })
}

test.describe.configure({ mode: 'serial' })

test.describe('控制面 E2E · 工作流地图视觉（R10/R11）', () => {
  test('两轮会话渲染出分步流程（Main flow / 步骤计数 / 节点卡）', async ({ page }) => {
    test.skip(!MOCK, 'mock 模型模式；真实模型视觉见下一条')
    await boot(page)
    await newSession(page)
    await send(page, '工作流视觉第一步：WORKFLOW_VISUAL_STEP_1')
    await expect(page.getByText(/MOCK_OK:/).first()).toBeVisible({ timeout: 120_000 })
    await send(page, '工作流视觉第二步：WORKFLOW_VISUAL_STEP_2')
    await expect(page.getByText(/MOCK_OK:/).nth(1)).toBeVisible({ timeout: 120_000 })

    await openWorkflowMap(page)
    await expect(page.getByText(/\d+\s*\/\s*\d+\s*steps/i).first()).toBeVisible()
    await expect(page.getByText(/\d+\s*\/\s*\d+/).first()).toBeVisible()
    await page.screenshot({ path: join(ART, '30-workflow-map-two-steps.png') })
    const text = await page.locator('body').innerText()
    expect(text).toMatch(/Main flow/i)
    expect(text).toMatch(/steps/i)
    expect(text.length).toBeGreaterThan(200)
  })

  test('真实模型工具调用后，地图显示 tools/files（可选，2 次调用）', async ({ page }) => {
    test.skip(!REAL_MODEL, '需要 --real-model（2 次真实调用）')
    await boot(page)
    await newSession(page)
    await send(page, '请先用 bash 运行 `echo workflow-visual-ok`，然后用一句话总结输出，不要做别的。')
    await expect(page.getByText(/Usage .*tok/).first()).toBeVisible({ timeout: 180_000 })
    await page.screenshot({ path: join(ART, '31-workflow-map-real-tool-reply.png') })

    await openWorkflowMap(page)
    await expect(page.getByText(/\d+\s*\/\s*\d+\s*steps/i).first()).toBeVisible({ timeout: 30_000 })
    const text = await page.locator('body').innerText()
    expect(text).toMatch(/[1-9]\d*\s*tools?/i)
    await page.screenshot({ path: join(ART, '32-workflow-map-real-tool.png') })
  })
})

import { defineConfig } from 'playwright/test'

const root = process.env.DSH_E2E_ROOT || '/tmp/dsh-e2e'

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: process.env.DSH_E2E_RUN_DIR ? `${process.env.DSH_E2E_RUN_DIR}/playwright-output` : `${root}/runs/playwright-output`,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
})

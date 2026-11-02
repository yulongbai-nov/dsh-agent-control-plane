import { defineConfig } from 'playwright/test'

const root = process.env.DSH_E2E_ROOT || '/tmp/dsh-e2e'

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  // `list` for the live log; failure-evidence collects screenshot/video/trace/GIF
  // for every failed test under $DSH_E2E_ARTIFACTS/failures/<runId>/<test-slug>/.
  // list for the live log; failure-evidence collects GIF/trace; test-report records every case + video.
  reporter: [['list'], ['./reporters/failure-evidence.mjs'], ['./reporters/test-report.mjs']],
  outputDir: process.env.DSH_E2E_RUN_DIR ? `${process.env.DSH_E2E_RUN_DIR}/playwright-output` : `${root}/runs/playwright-output`,
  use: {
    headless: true,
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: 'on',
    trace: 'retain-on-failure',
  },
})

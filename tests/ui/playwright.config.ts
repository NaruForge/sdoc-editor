import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);
const port = Number.parseInt(process.env.SDOC_UI_TEST_PORT ?? '4307', 10);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './specs',
  outputDir: './artifacts/test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  workers: isCi ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './artifacts/report', open: 'never' }],
  ],
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm exec vite -- --config vite.config.ts',
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

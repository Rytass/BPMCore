import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [['list']],
  testDir: './specs',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:17602',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
});

import { defineConfig, devices } from '@playwright/test';

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '5000', 10);
const baseURL = `http://127.0.0.1:${port}`;
const prebuiltBrowserServer = process.env.CABLE_PLAYWRIGHT_PREBUILT === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: 'desktop/**',
  timeout: 120_000,
  retries: process.env.PERF_UPDATE_BASELINE === '1'
    ? 0
    : (process.env.CI ? 1 : 0),
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: prebuiltBrowserServer
      ? 'corepack pnpm@9.15.9 start:browser'
      : 'corepack pnpm@9.15.9 build && corepack pnpm@9.15.9 start:browser',
    url: baseURL,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DEPLOY_RUN_PORT: String(port),
      PORT: String(port),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

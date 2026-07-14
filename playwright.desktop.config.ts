import path from 'node:path';

import { defineConfig } from '@playwright/test';

const reportPlatform = process.platform === 'win32' ? 'win' : 'mac';

export default defineConfig({
  testDir: './tests/e2e/desktop',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: path.join('artifacts', 'desktop-e2e', reportPlatform),
  reporter: [
    ['line'],
    ['json', { outputFile: path.join('artifacts', 'acceptance', `desktop-${reportPlatform}.json`) }],
  ],
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop-mac',
      testIgnore: process.platform === 'darwin' ? [] : ['**/*.spec.ts'],
    },
    {
      name: 'desktop-win',
      testIgnore: process.platform === 'win32' ? [] : ['**/*.spec.ts'],
    },
  ],
});

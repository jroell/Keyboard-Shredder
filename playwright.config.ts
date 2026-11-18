import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: process.env.LIVE_MUSIC_SECONDS ? 'test-results/live-' + process.env.LIVE_MUSIC_SECONDS : 'test-results/fixtures',
  testMatch: '*.spec.ts',
  timeout: 600_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
  use: { actionTimeout: 15_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: process.env.LIVE_MUSIC_SECONDS
    ? [{ name: 'chromium', use: { browserName: 'chromium' } }]
    : [
      { name: 'chromium', use: { browserName: 'chromium' } },
      {
        name: 'firefox',
        use: {
          browserName: 'firefox',
          viewport: { width: 960, height: 640 },
          reducedMotion: 'reduce',
          trace: { mode: 'retain-on-failure', screenshots: false },
        },
      },
    ],
});

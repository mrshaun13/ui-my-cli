// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Codex Dashboard.
 *
 * IMPORTANT: Tests run against the live PM2-managed server.
 * The dashboard must be running before you run tests.
 *
 * Quick start:
 *   pm2 list                     # confirm codex-dashboard is "online"
 *   npm test                     # run all tests
 *   npx playwright test <file>   # run a single test file
 *
 * If the server isn't running, start it:
 *   npm run pm2:start            # builds client + starts PM2
 */

const PORT = process.env.PORT || 7575;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Do NOT use webServer — this project runs under PM2.
   * Tests detect whether the server is reachable and fail fast with a
   * clear message if it isn't (see tests/helpers.js).
   *
   * If you need to start the server manually:
   *   npm run pm2:start
   *
   * Or without PM2:
   *   npm run build && npm start
   */
});

// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Codex Dashboard.
 *
 * Tests start a processless synthetic dashboard on a dedicated loopback port.
 * The fixture rejects production providers, databases, PTYs, child processes,
 * native launchers, and filesystem watchers.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4174);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535 || PORT === 7575) {
  throw new Error(`Refusing unsafe Playwright port: ${process.env.PLAYWRIGHT_PORT || PORT}`);
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
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

  webServer: {
    command: 'node --require ./tests/fixtures/isolation-guard.cjs tests/fixtures/isolated-dashboard-server.js',
    url: `http://127.0.0.1:${PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
    },
  },
});

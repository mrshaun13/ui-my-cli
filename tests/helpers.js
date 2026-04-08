/**
 * Test helpers — shared utilities for all Playwright tests.
 *
 * Usage in a spec file:
 *   import { ensureServerRunning, waitForSessions, SELECTORS } from './helpers.js';
 *   test.beforeAll(ensureServerRunning);
 */
import { request } from '@playwright/test';

const PORT = process.env.PORT || 7575;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Call in test.beforeAll() to verify the dashboard is reachable.
 * Fails fast with a helpful message instead of cryptic timeouts.
 */
export async function ensureServerRunning() {
  const ctx = await request.newContext();
  try {
    const res = await ctx.get(`${BASE_URL}/api/status`, { timeout: 3000 });
    if (!res.ok()) {
      throw new Error(`Server returned ${res.status()}`);
    }
    // Also verify there are sessions to test against
    const sessRes = await ctx.get(`${BASE_URL}/api/sessions`, { timeout: 3000 });
    const sessions = await sessRes.json();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      console.warn(
        'WARNING: No active sessions found. Tests that interact with ' +
        'session cards will be skipped. Run `devin` to create a session.'
      );
    }
  } catch (err) {
    throw new Error(
      `Dashboard not reachable at ${BASE_URL}.\n` +
      `Start it first:  npm run pm2:start\n` +
      `Or check:        pm2 list\n` +
      `Original error:  ${err.message}`
    );
  } finally {
    await ctx.dispose();
  }
}

/**
 * Navigate to the dashboard and wait for session cards to appear.
 * Sessions arrive via WebSocket (not initial HTML), so we need to wait
 * for the /ws/status connection to deliver the first 'sessions' message.
 *
 * Returns the number of visible session cards.
 */
export async function waitForSessions(page, { timeout = 15000 } = {}) {
  await page.goto('/');
  // Wait for the sidebar to render session cards (WebSocket-driven)
  await page.waitForSelector(SELECTORS.agentCard, { timeout });
  return await page.locator(SELECTORS.agentCard).count();
}

/** CSS selectors used across the UI — keep in sync with components. */
export const SELECTORS = {
  sidebar: '.sidebar',
  agentCard: '.agent-card',
  mainArea: '.main-area',
  topbar: '.topbar',
  controlbar: '.controlbar',
  searchInput: '.sidebar-search-input',
  newSessionFab: '.new-session-fab',
  statusIcon: '.agent-status-icon',
  topbarLogo: '.topbar-logo',
  terminal: '.xterm',
  tabBar: '.tab-bar',
  tabItem: '.tab-item',
  tabActive: '.tab-item.tab-active',
  tabInsightsBtn: '.tab-insights-btn',
  tabCloseBtn: '.tab-close-btn',
  previewWrap: '.preview-wrap',
};

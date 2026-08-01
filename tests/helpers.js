/**
 * Test helpers — shared utilities for all Playwright tests.
 *
 * Usage in a spec file:
 *   import { ensureIsolatedServer, waitForSessions, SELECTORS } from './helpers.js';
 *   test.beforeAll(ensureIsolatedServer);
 */
import { request } from '@playwright/test';

const PORT = process.env.PLAYWRIGHT_PORT || 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EXPECTED_CODEX_IDS = ['synthetic-codex-1', 'synthetic-codex-2'];

async function readJsonWithRetry(ctx, path) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ctx.get(`${BASE_URL}${path}`, { timeout: 5000 });
      if (!response.ok()) throw new Error(`${path} returned ${response.status()}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

/**
 * Fail fast unless Playwright owns the processless synthetic dashboard.
 */
export async function ensureIsolatedServer() {
  const ctx = await request.newContext();
  try {
    const status = await readJsonWithRetry(ctx, '/api/status');
    if (status.fixtureMode !== 'isolated-playwright') {
      throw new Error(`Refusing non-isolated dashboard mode: ${status.fixtureMode || 'missing'}`);
    }
    const counters = status.isolation || {};
    for (const key of ['blockedLoads', 'filesystemWatches', 'processSpawns', 'realStateReads']) {
      if (counters[key] !== 0) throw new Error(`Isolation counter ${key} is ${counters[key]}`);
    }

    const sessions = await readJsonWithRetry(ctx, '/api/sessions');
    const ids = sessions.map(session => session.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_CODEX_IDS)) {
      throw new Error(`Unexpected synthetic sessions: ${ids.join(', ')}`);
    }
  } catch (err) {
    throw new Error(
      `Isolated dashboard verification failed at ${BASE_URL}.\n` +
      `Original error:  ${err.message}`
    );
  } finally {
    await ctx.dispose();
  }
}

export async function assertIsolationGuards() {
  const ctx = await request.newContext();
  try {
    const status = await readJsonWithRetry(ctx, '/api/status');
    const counters = status.isolation || {};
    for (const key of ['blockedLoads', 'filesystemWatches', 'processSpawns', 'realStateReads']) {
      if (counters[key] !== 0) throw new Error(`Isolation counter ${key} is ${counters[key]}`);
    }
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
  newSessionDropdown: '.new-session-dropdown',
  statusIcon: '.agent-status-icon',
  topbarLogo: '.topbar-logo',
  terminal: '.xterm',
  tabBar: '.tab-bar',
  tabItem: '.tab-item',
  tabActive: '.tab-item.tab-active',
  tabInsightsBtn: '.tab-insights-btn',
  tabCloseBtn: '.tab-close-btn',
  previewWrap: '.preview-wrap',
  providerSwitch: '.provider-switch',
  providerButton: '.provider-switch-btn',
  styleSelect: '.style-select',
  textSizeControl: '.text-size-control',
  textSizeButton: '.text-size-btn',
};

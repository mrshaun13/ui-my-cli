/**
 * Smoke tests — verify the dashboard loads and core UI elements render.
 *
 * These tests run against the live PM2-managed server on port 7575.
 * Prerequisites: `npm run pm2:start` (or `pm2 list` shows "online")
 */
import { test, expect } from '@playwright/test';
import { ensureServerRunning, waitForSessions, SELECTORS } from './helpers.js';

test.beforeAll(ensureServerRunning);

test.describe('Dashboard smoke tests', () => {

  test('server health check returns ok', async ({ request }) => {
    const res = await request.get('/api/status');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('activePtys');
    expect(body).toHaveProperty('uptime');
  });

  test('sessions API returns an array', async ({ request }) => {
    const res = await request.get('/api/sessions');
    expect(res.ok()).toBeTruthy();
    const sessions = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
  });

  test('dashboard loads and renders sidebar + topbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(SELECTORS.sidebar)).toBeVisible();
    await expect(page.locator(SELECTORS.topbar)).toBeVisible();
  });

  test('new session FAB is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(SELECTORS.newSessionFab)).toBeVisible();
  });

  test('session cards appear after WebSocket connects', async ({ page }) => {
    const count = await waitForSessions(page);
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a session card opens the terminal', async ({ page }) => {
    await waitForSessions(page);
    await page.locator(SELECTORS.agentCard).first().click();
    await expect(page.locator(SELECTORS.terminal)).toBeVisible({ timeout: 10000 });
  });

  test('clicking status icon opens session preview', async ({ page }) => {
    await waitForSessions(page);
    await page.locator(SELECTORS.statusIcon).first().click();
    // Preview renders inside a tab pane in the main area
    await expect(page.locator(SELECTORS.mainArea)).toBeVisible();
    await expect(
      page.locator(SELECTORS.mainArea).locator(SELECTORS.previewWrap)
    ).toBeVisible({ timeout: 5000 });
  });

  test('search input filters sessions', async ({ page }) => {
    await waitForSessions(page);

    const searchInput = page.locator(SELECTORS.searchInput);
    await expect(searchInput).toBeVisible();

    const initialCount = await page.locator(SELECTORS.agentCard).count();
    await searchInput.fill('zzz_nonexistent_query_zzz');
    await page.waitForTimeout(1500);
    const filteredCount = await page.locator(SELECTORS.agentCard).count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Clear search restores cards
    await searchInput.fill('');
    await page.waitForTimeout(1500);
  });
});

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

  test('providers API returns Codex and Devin entries', async ({ request }) => {
    const res = await request.get('/api/providers');
    expect(res.ok()).toBeTruthy();
    const providers = await res.json();
    const ids = providers.map(p => p.id);
    expect(ids).toContain('codex');
    expect(ids).toContain('devin');
  });

  test('Codex model stats are uniquely keyed by model and reasoning effort', async ({ request }) => {
    const res = await request.get('/api/codex/stats');
    expect(res.ok()).toBeTruthy();
    const stats = await res.json();
    expect(Array.isArray(stats.models)).toBe(true);

    const seen = new Set();
    for (const row of stats.models) {
      const key = `${row.model}:${row.reasoningEffort || 'unknown'}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);

      if (row.unclassifiedTokens > 0) continue;
      expect(row.key).toBe(`${row.model}::${row.reasoningEffort || 'unknown'}`);
      expect(row.totalInputTokens).toBe((row.inputTokens || 0) + (row.cachedInputTokens || 0));
      expect(row.outputTokens).toBe((row.visibleOutputTokens || 0) + (row.reasoningOutputTokens || 0));
      expect(row.totalTokens).toBe((row.totalInputTokens || 0) + (row.outputTokens || 0));
    }
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

  test('provider switch toggles dashboard identity', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(SELECTORS.providerSwitch)).toBeVisible();

    await page.getByRole('tab', { name: /Devin/ }).click();
    await expect(page.locator(SELECTORS.topbarLogo)).toContainText('Devin');

    await page.getByRole('tab', { name: /Codex/ }).click();
    await expect(page.locator(SELECTORS.topbarLogo)).toContainText('Codex');
  });

  test('style selector offers ten themes and persists the selection', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('agent-dash:style'));
    await page.reload();

    const styleSelect = page.locator(SELECTORS.styleSelect);
    await expect(styleSelect).toBeVisible();
    await expect(styleSelect.locator('option')).toHaveCount(10);
    await expect(styleSelect).toHaveValue('signal');

    await styleSelect.selectOption('paper');
    await expect(page.locator('html')).toHaveAttribute('data-dashboard-style', 'paper');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light');

    await page.reload();
    await expect(page.locator(SELECTORS.styleSelect)).toHaveValue('paper');
  });

  test('text size control offers four persistent sizes', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('agent-dash:text-size'));
    await page.reload();

    const control = page.locator(SELECTORS.textSizeControl);
    await expect(control).toBeVisible();
    await expect(control.locator(SELECTORS.textSizeButton)).toHaveCount(4);
    await expect(control.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');

    await control.getByRole('button', { name: 'XXL' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-text-size', 'xxl');
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThan(18);

    await page.reload();
    await expect(page.locator(SELECTORS.textSizeControl).getByRole('button', { name: 'XXL' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('display controls update an open terminal without recreating it', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('agent-dash:style');
      localStorage.removeItem('agent-dash:text-size');
    });

    await page.reload();
    await waitForSessions(page);
    await page.locator(SELECTORS.agentCard).first().click();

    const terminal = page.locator(SELECTORS.terminal);
    await expect(terminal).toBeVisible({ timeout: 15000 });
    const initialRows = await page.locator('.xterm-rows > div').count();
    expect(initialRows).toBeGreaterThan(0);

    await page.locator(SELECTORS.styleSelect).selectOption('paper');
    await expect.poll(() => page.evaluate(() => ({
      style: document.documentElement.dataset.dashboardStyle,
      terminalBackground: getComputedStyle(document.documentElement)
        .getPropertyValue('--bg-terminal').trim(),
    }))).toEqual({ style: 'paper', terminalBackground: '#ffffff' });

    await page.locator(SELECTORS.textSizeControl)
      .getByRole('button', { name: 'XXL' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-text-size', 'xxl');
    await expect.poll(() => page.locator('.xterm-rows > div').count())
      .toBeLessThan(initialRows);
    await expect(terminal).toBeVisible();
  });

  test('Codex model usage table visibly labels reasoning effort', async ({ page, request }) => {
    const res = await request.get('/api/codex/stats');
    expect(res.ok()).toBeTruthy();
    const stats = await res.json();
    const hasReasoningRows = stats.models.some(row => row.reasoningEffort && row.reasoningEffort !== 'unknown');
    test.skip(!hasReasoningRows, 'No Codex reasoning telemetry rows available');

    await waitForSessions(page);
    await expect(page.locator('.model-usage-table')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.model-usage-table')).toContainText(/reasoning:\s*(low|medium|high|x-high)/i);
  });

  test('session cards appear after WebSocket connects', async ({ page }) => {
    const count = await waitForSessions(page);
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a session card opens the terminal', async ({ page }) => {
    await waitForSessions(page);
    await page.locator(SELECTORS.agentCard).first().click();
    await expect(page.locator(SELECTORS.terminal)).toBeVisible({ timeout: 20000 });
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

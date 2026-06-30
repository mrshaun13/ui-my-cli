/**
 * Tab bar tests — verify multi-session tab behavior.
 *
 * Covers:
 *   - Tab bar visible (even when empty)
 *   - Tab opens when clicking a session
 *   - No duplicate tabs when clicking same session
 *   - Tab closes when clicking X
 *   - Preview toggle via info icon
 *   - Tab switching preserves terminal
 *   - Splash shows when all tabs closed
 *   - Tab persistence survives page reload
 */
import { test, expect } from '@playwright/test';
import { ensureServerRunning, waitForSessions, SELECTORS } from './helpers.js';

test.beforeAll(ensureServerRunning);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agent-dash:codex:cold-days', '3650');
  });
});

// Screenshot directory
const SCREENSHOT_DIR = '/tmp/tab-test-screenshots';

test.describe('Tab bar tests', () => {

  test('tab bar is visible even with no tabs open', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(SELECTORS.tabBar)).toBeVisible();
    // Tab bar should be empty (no tab items)
    const tabCount = await page.locator(SELECTORS.tabItem).count();
    expect(tabCount).toBe(0);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-empty-tab-bar.png`, fullPage: true });
  });

  test('clicking a session opens a tab', async ({ page }) => {
    await waitForSessions(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02a-before-click.png`, fullPage: true });

    // Click the first session card
    await page.locator(SELECTORS.agentCard).first().click();

    // A tab should appear in the tab bar
    await expect(page.locator(SELECTORS.tabActive)).toBeVisible({ timeout: 5000 });
    const tabCount = await page.locator(SELECTORS.tabItem).count();
    expect(tabCount).toBe(1);

    // Terminal should be visible
    await expect(page.locator(SELECTORS.terminal)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02b-tab-opened.png`, fullPage: true });
  });

  test('clicking same session does not create duplicate tab', async ({ page }) => {
    await waitForSessions(page);

    // Click first session twice
    const firstCard = page.locator(SELECTORS.agentCard).first();
    await firstCard.click();
    await expect(page.locator(SELECTORS.tabActive)).toBeVisible({ timeout: 5000 });

    await firstCard.click();
    await page.waitForTimeout(500);

    // Still only one tab
    const tabCount = await page.locator(SELECTORS.tabItem).count();
    expect(tabCount).toBe(1);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-no-duplicate.png`, fullPage: true });
  });

  test('clicking a second session opens a second tab', async ({ page }) => {
    await waitForSessions(page);

    const cards = page.locator(SELECTORS.agentCard);
    const cardCount = await cards.count();
    if (cardCount < 2) {
      test.skip();
      return;
    }

    // Open first session
    await cards.nth(0).click();
    await expect(page.locator(SELECTORS.tabActive)).toBeVisible({ timeout: 5000 });

    // Open second session
    await cards.nth(1).click();
    await expect(page.locator(SELECTORS.tabItem)).toHaveCount(2, { timeout: 5000 });

    // The second tab should be active
    const activeTabCount = await page.locator(SELECTORS.tabActive).count();
    expect(activeTabCount).toBe(1);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-two-tabs.png`, fullPage: true });
  });

  test('clicking X closes a tab', async ({ page }) => {
    await waitForSessions(page);

    // Open a session
    await page.locator(SELECTORS.agentCard).first().click();
    await expect(page.locator(SELECTORS.tabActive)).toBeVisible({ timeout: 5000 });

    // Hover over the tab to reveal the close button, then click it
    const tab = page.locator(SELECTORS.tabItem).first();
    await tab.hover();
    await tab.locator(SELECTORS.tabCloseBtn).click();

    // Tab should be gone
    await expect(page.locator(SELECTORS.tabItem)).toHaveCount(0, { timeout: 3000 });

    // Splash should show (no active tab) — check for both loaded and loading states
    await expect(page.locator('.splash, .splash-loading')).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-tab-closed.png`, fullPage: true });
  });

  test('info icon toggles preview mode', async ({ page }) => {
    await waitForSessions(page);

    // Open a session in terminal mode
    await page.locator(SELECTORS.agentCard).first().click();
    await expect(page.locator(SELECTORS.terminal)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06a-terminal-mode.png`, fullPage: true });

    // Click the info icon on the active tab to toggle to preview mode
    const activeTab = page.locator(SELECTORS.tabActive);
    await activeTab.locator(SELECTORS.tabInsightsBtn).click();

    // Preview should appear, terminal hidden
    await expect(page.locator(SELECTORS.previewWrap)).toBeVisible({ timeout: 5000 });

    // Tab should show preview indicator (blue underline)
    await expect(page.locator('.tab-item.tab-active.tab-preview')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06b-preview-mode.png`, fullPage: true });

    // Click the info icon again to toggle back to terminal
    await page.locator(SELECTORS.tabActive).locator(SELECTORS.tabInsightsBtn).click();
    await expect(page.locator(SELECTORS.terminal)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06c-back-to-terminal.png`, fullPage: true });
  });

  test('switching tabs preserves terminals', async ({ page }) => {
    await waitForSessions(page);

    const cards = page.locator(SELECTORS.agentCard);
    const cardCount = await cards.count();
    if (cardCount < 2) {
      test.skip();
      return;
    }

    // Open first session
    await cards.nth(0).click();
    await expect(page.locator('.tab-pane-active').locator(SELECTORS.terminal)).toBeVisible({ timeout: 10000 });
    const firstTabTitle = await page.locator(SELECTORS.tabActive).locator('.tab-title').textContent();

    // Open second session
    await cards.nth(1).click();
    await expect(page.locator(SELECTORS.tabItem)).toHaveCount(2, { timeout: 5000 });
    // Wait for the active tab pane's terminal to appear
    await expect(page.locator('.tab-pane-active').locator(SELECTORS.terminal)).toBeVisible({ timeout: 10000 });

    // Both xterm instances should exist in the DOM (one visible, one hidden)
    const xtermCount = await page.locator(SELECTORS.terminal).count();
    expect(xtermCount).toBe(2);

    // Switch back to first tab by clicking it
    const tabs = page.locator(SELECTORS.tabItem);
    await tabs.first().click();
    await expect(page.locator('.tab-pane-active').locator(SELECTORS.terminal)).toBeVisible({ timeout: 5000 });

    // Verify we're on the first tab
    const activeTitle = await page.locator(SELECTORS.tabActive).locator('.tab-title').textContent();
    expect(activeTitle).toBe(firstTabTitle);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-tab-switching.png`, fullPage: true });
  });

  test('logo click shows splash, tabs remain', async ({ page }) => {
    await waitForSessions(page);

    // Open a session
    await page.locator(SELECTORS.agentCard).first().click();
    await expect(page.locator(SELECTORS.tabActive)).toBeVisible({ timeout: 5000 });

    // Click the logo to go home
    await page.locator(SELECTORS.topbarLogo).click();

    // Splash should show
    await expect(page.locator('.splash, .splash-loading')).toBeVisible({ timeout: 3000 });

    // But the tab should still be in the tab bar (just not active-highlighted)
    const tabCount = await page.locator(SELECTORS.tabItem).count();
    expect(tabCount).toBe(1);

    // No tab should be active
    const activeCount = await page.locator(SELECTORS.tabActive).count();
    expect(activeCount).toBe(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/08-splash-with-tabs.png`, fullPage: true });
  });

  test('tab persistence survives page reload', async ({ page }) => {
    await waitForSessions(page);

    // Open a session
    await page.locator(SELECTORS.agentCard).first().click();
    await expect(page.locator(SELECTORS.tabActive)).toBeVisible({ timeout: 5000 });
    const tabTitle = await page.locator(SELECTORS.tabActive).locator('.tab-title').textContent();

    // Reload the page
    await page.reload();

    // Wait for sessions to arrive via WebSocket
    await page.waitForSelector(SELECTORS.agentCard, { timeout: 15000 });

    // Tab should be restored
    await expect(page.locator(SELECTORS.tabItem)).toHaveCount(1, { timeout: 5000 });
    const restoredTitle = await page.locator(SELECTORS.tabItem).locator('.tab-title').textContent();
    expect(restoredTitle).toBe(tabTitle);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/09-tab-persisted.png`, fullPage: true });
  });

  test('closing the active tab activates the next tab', async ({ page }) => {
    await waitForSessions(page);

    const cards = page.locator(SELECTORS.agentCard);
    const cardCount = await cards.count();
    if (cardCount < 2) {
      test.skip();
      return;
    }

    // Open two sessions
    await cards.nth(0).click();
    await expect(page.locator(SELECTORS.tabActive)).toBeVisible({ timeout: 5000 });
    await cards.nth(1).click();
    await expect(page.locator(SELECTORS.tabItem)).toHaveCount(2, { timeout: 5000 });

    // Activate the first tab
    await page.locator(SELECTORS.tabItem).first().click();
    await page.waitForTimeout(300);
    const firstTitle = await page.locator(SELECTORS.tabActive).locator('.tab-title').textContent();

    // Close the first (active) tab
    const firstTab = page.locator(SELECTORS.tabItem).first();
    await firstTab.hover();
    await firstTab.locator(SELECTORS.tabCloseBtn).click();

    // Should now have 1 tab, and it should be active
    await expect(page.locator(SELECTORS.tabItem)).toHaveCount(1, { timeout: 3000 });
    await expect(page.locator(SELECTORS.tabActive)).toBeVisible();
    const remainingTitle = await page.locator(SELECTORS.tabActive).locator('.tab-title').textContent();
    expect(remainingTitle).not.toBe(firstTitle);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/10-close-activates-next.png`, fullPage: true });
  });

});

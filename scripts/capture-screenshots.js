#!/usr/bin/env node
// capture-screenshots.js — Playwright script to capture user-guide screenshots
// Usage: node scripts/capture-screenshots.js
//
// Requires: Playwright + Chromium installed globally (npm i -g playwright && npx playwright install chromium)
// Expects:  Codex Dashboard running at http://localhost:7575

// Playwright may be installed globally — try local first, fall back to global node_modules
let pw;
try { pw = require('playwright'); } catch {
  const prefix = require('child_process')
    .execSync('npm config get prefix', { encoding: 'utf8' }).trim();
  pw = require(require('path').join(prefix, 'lib', 'node_modules', 'playwright'));
}
const { chromium } = pw;
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:7575';
const OUT  = path.join(__dirname, '..', 'docs', 'screenshots');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  console.log('Navigating to dashboard...');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.agent-card', { timeout: 10000 });
  await sleep(2500); // let charts & WebSocket data arrive

  // ─── 1. Dashboard Home (splash with analytics) ────────────────────
  console.log('  1/11  Dashboard home (splash)');
  await page.screenshot({ path: path.join(OUT, '01-dashboard-home.png') });

  // ─── 2. Sidebar close-up ──────────────────────────────────────────
  console.log('  2/11  Sidebar close-up');
  const sidebar = await page.$('.sidebar');
  if (sidebar) {
    await sidebar.screenshot({ path: path.join(OUT, '02-sidebar.png') });
  } else console.warn('  ⚠ .sidebar not found');

  // ─── 3. Analytics detail (main area only) ─────────────────────────
  console.log('  3/11  Analytics top');
  const mainArea = await page.$('.main-area');
  if (mainArea) {
    await mainArea.evaluate(el => el.scrollTop = 0);
    await sleep(500);
    await mainArea.screenshot({ path: path.join(OUT, '03-analytics-top.png') });

    console.log('  4/11  Analytics leaderboards');
    await mainArea.evaluate(el => el.scrollTop = el.scrollHeight);
    await sleep(500);
    await mainArea.screenshot({ path: path.join(OUT, '04-analytics-leaderboards.png') });
    await mainArea.evaluate(el => el.scrollTop = 0);
  }

  // ─── 4. Session Preview — click status icon on first card ─────────
  console.log('  5/11  Session preview');
  const statusIcon = await page.$('.agent-status-icon');
  if (statusIcon) {
    await statusIcon.click();
    await sleep(2500); // preview loads data from /api/sessions/:id/preview
    await page.screenshot({ path: path.join(OUT, '05-session-preview.png') });

    // Scroll down to show more preview content
    console.log('  6/11  Session preview (scrolled)');
    if (mainArea) {
      await mainArea.evaluate(el => el.scrollTop = 500);
      await sleep(500);
      await page.screenshot({ path: path.join(OUT, '06-session-preview-details.png') });
      await mainArea.evaluate(el => el.scrollTop = 0);
    }
  } else console.warn('  ⚠ .agent-status-icon not found');

  // ─── 5. Live Terminal — click a card body to open terminal ────────
  console.log('  7/11  Live terminal');
  // Go home first, then click on a card
  const logo = await page.$('.topbar-logo');
  if (logo) await logo.click();
  await sleep(1000);

  const card = await page.$('.agent-card');
  if (card) {
    await card.click();
    await sleep(3000); // PTY connect + terminal render
    await page.screenshot({ path: path.join(OUT, '07-live-terminal.png') });
  } else console.warn('  ⚠ .agent-card not found');

  // ─── 6. Topbar detail (env chips + context pie) ───────────────────
  console.log('  8/11  Topbar detail');
  const topbar = await page.$('.topbar');
  if (topbar) {
    await topbar.screenshot({ path: path.join(OUT, '08-topbar.png') });
  }

  // ─── 7. Control bar detail ────────────────────────────────────────
  console.log('  9/11  Control bar');
  const controlbar = await page.$('.controlbar');
  if (controlbar) {
    await controlbar.screenshot({ path: path.join(OUT, '09-controlbar.png') });
  } else console.warn('  ⚠ .controlbar not found');

  // ─── 8. Search ────────────────────────────────────────────────────
  console.log(' 10/11  Search');
  if (logo) await logo.click();
  await sleep(1000);

  const searchInput = await page.$('.sidebar-search-input');
  if (searchInput) {
    await searchInput.click();
    await searchInput.fill('breadcrumbs');
    await sleep(1000); // debounced search
    await page.screenshot({ path: path.join(OUT, '10-search.png') });
    await searchInput.fill('');
    await sleep(500);
  } else console.warn('  ⚠ .sidebar-search-input not found');

  // ─── 9. New Session FAB ───────────────────────────────────────────
  console.log(' 11/11  New session button');
  const fab = await page.$('.new-session-fab');
  if (fab) {
    await fab.click();
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, '11-new-session.png') });
  } else console.warn('  ⚠ .new-session-fab not found');

  console.log(`Done! Screenshots saved to ${OUT}`);
  await browser.close();
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

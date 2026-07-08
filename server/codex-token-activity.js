/**
 * Builds exact hourly and weekday token activity for every analytics window.
 */

'use strict';

const TOKEN_WINDOWS = Object.freeze([
  Object.freeze({ key: '1d', seconds: 86400 }),
  Object.freeze({ key: '2d', seconds: 172800 }),
  Object.freeze({ key: '7d', seconds: 604800 }),
  Object.freeze({ key: '14d', seconds: 1209600 }),
  Object.freeze({ key: '30d', seconds: 2592000 }),
  Object.freeze({ key: 'all', seconds: Infinity }),
]);

function emptyTokenWindows() {
  const make = () => ({ input: new Array(24).fill(0), output: new Array(24).fill(0) });
  return Object.fromEntries(TOKEN_WINDOWS.map(window => [window.key, make()]));
}

function emptyTokenHeatmap() {
  const windows = Object.fromEntries(TOKEN_WINDOWS.map(window => [window.key, 0]));
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ windows: { ...windows } }))
  );
}

function addTokenActivity(
  tokensByHour,
  heatmap,
  epochSec,
  usage,
  nowSec = Math.floor(Date.now() / 1000)
) {
  if (!epochSec || !usage) return;
  const inputTokens = typeof usage === 'number'
    ? 0
    : Number(usage.inputTokens || 0) + Number(usage.cacheReadTokens || 0);
  const outputTokens = typeof usage === 'number'
    ? Number(usage)
    : Number(usage.outputTokens || usage.totalTokens || 0);
  const totalTokens = typeof usage === 'number'
    ? Number(usage)
    : Number(usage.totalTokens || inputTokens + outputTokens);
  if (![inputTokens, outputTokens, totalTokens].every(Number.isFinite)) return;
  if (!inputTokens && !outputTokens && !totalTokens) return;

  const timestamp = Number(epochSec);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return;
  const age = Math.max(0, nowSec - timestamp);
  const date = new Date(timestamp * 1000);
  const hour = date.getHours();
  const day = (date.getDay() + 6) % 7; // Monday = 0

  for (const window of TOKEN_WINDOWS) {
    if (age > window.seconds) continue;
    tokensByHour[window.key].input[hour] += inputTokens;
    tokensByHour[window.key].output[hour] += outputTokens;
    heatmap[day][hour].windows[window.key] += totalTokens;
  }
}

module.exports = {
  TOKEN_WINDOWS,
  emptyTokenWindows,
  emptyTokenHeatmap,
  addTokenActivity,
};

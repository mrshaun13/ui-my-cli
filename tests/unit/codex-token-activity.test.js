'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TOKEN_WINDOWS,
  emptyTokenWindows,
  emptyTokenHeatmap,
  addTokenActivity,
} = require('../../server/codex-token-activity');

const sum = values => values.reduce((total, value) => total + value, 0);
const heatmapTotal = (heatmap, window) => heatmap
  .flat()
  .reduce((total, cell) => total + cell.windows[window], 0);

test('token activity windows contain exact non-overlapping cutoff behavior', () => {
  const now = 10_000_000;
  const tokensByHour = emptyTokenWindows();
  const heatmap = emptyTokenHeatmap();
  const events = [
    { age: 12 * 3600, tokens: 10 },
    { age: 36 * 3600, tokens: 20 },
    { age: 5 * 86400, tokens: 30 },
    { age: 10 * 86400, tokens: 40 },
    { age: 20 * 86400, tokens: 50 },
    { age: 40 * 86400, tokens: 60 },
  ];
  for (const event of events) {
    addTokenActivity(tokensByHour, heatmap, now - event.age, {
      inputTokens: event.tokens,
      outputTokens: event.tokens,
      totalTokens: event.tokens,
    }, now);
  }

  const expected = { '1d': 10, '2d': 30, '7d': 60, '14d': 100, '30d': 150, all: 210 };
  assert.deepEqual(TOKEN_WINDOWS.map(window => window.key), Object.keys(expected));
  for (const [window, total] of Object.entries(expected)) {
    assert.equal(sum(tokensByHour[window].input), total, `${window} hourly input`);
    assert.equal(sum(tokensByHour[window].output), total, `${window} hourly output`);
    assert.equal(heatmapTotal(heatmap, window), total, `${window} heatmap`);
  }
});

test('48-hour heatmap data does not leak into the 24-hour bucket', () => {
  const now = 10_000_000;
  const tokensByHour = emptyTokenWindows();
  const heatmap = emptyTokenHeatmap();
  addTokenActivity(tokensByHour, heatmap, now - (36 * 3600), {
    inputTokens: 25,
    outputTokens: 5,
    totalTokens: 30,
  }, now);

  assert.equal(heatmapTotal(heatmap, '1d'), 0);
  assert.equal(heatmapTotal(heatmap, '2d'), 30);
  assert.equal(sum(tokensByHour['1d'].input), 0);
  assert.equal(sum(tokensByHour['2d'].input), 25);
});

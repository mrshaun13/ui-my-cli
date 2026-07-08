'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateCredits, normalizePricedModel } = require('../../server/codex-pricing');
const { buildUsageRollups } = require('../../server/codex-usage-rollups');

test('published credit rates price fresh, cached, and all output tokens', () => {
  const estimate = estimateCredits({
    inputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningOutputTokens: 250_000,
    totalTokens: 3_000_000,
  }, 'gpt-5.5');
  assert.equal(estimate.estimatedCredits, 887.5);
  assert.equal(estimate.pricedTokens, 3_000_000);
  assert.equal(estimate.unpricedTokens, 0);
});

test('unknown model aliases remain unpriced instead of inheriting a guessed rate', () => {
  assert.equal(normalizePricedModel('gpt-5.6-sol'), null);
  assert.deepEqual(estimateCredits({ totalTokens: 42_000 }, 'gpt-5.6-sol'), {
    estimatedCredits: 0,
    pricedTokens: 0,
    unpricedTokens: 42_000,
    pricingModel: null,
  });
});

test('rollups expose every selectable window with model, project, and session totals', () => {
  const now = 2_000_000;
  const usage = (total, input, cached, output) => ({
    totalTokens: total,
    totalInputTokens: input + cached,
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    visibleOutputTokens: output,
    reasoningOutputTokens: 0,
    calls: 1,
  });
  const result = buildUsageRollups([
    {
      timestamp: now - 3600,
      usage: usage(100, 40, 20, 40),
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      project: 'alpha',
      session: { id: 'one', title: 'One', model: 'gpt-5.5', reasoningEffort: 'medium' },
    },
    {
      timestamp: now - (3 * 86400),
      usage: usage(200, 100, 50, 50),
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      project: 'beta',
      session: { id: 'two', title: 'Two', model: 'gpt-5.4', reasoningEffort: 'high' },
    },
  ], now);

  assert.equal(result['1d'].totals.totalTokens, 100);
  assert.equal(result['1d'].projects.length, 1);
  assert.equal(result['2d'].totals.totalTokens, 100);
  assert.equal(result['7d'].totals.totalTokens, 300);
  assert.equal(result['14d'].totals.totalTokens, 300);
  assert.equal(result['30d'].totals.totalTokens, 300);
  assert.equal(result.all.totals.totalTokens, 300);
  assert.deepEqual(Object.keys(result), ['1d', '2d', '7d', '14d', '30d', 'all']);
  assert.deepEqual(result['7d'].models.map(row => row.model), ['gpt-5.4', 'gpt-5.5']);
  assert.deepEqual(result['7d'].projects.map(row => row.name), ['beta', 'alpha']);
  assert.deepEqual(result['7d'].sessions.map(row => row.id), ['two', 'one']);
  assert.equal(result['7d'].totals.pricingCoverage, 1);
});

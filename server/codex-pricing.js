'use strict';

const RATE_CARD_SOURCE = 'https://developers.openai.com/codex/pricing?codex-usage-limits=business';
const RATE_CARD_VERSION = '2026-07-08';

// Credits per one million tokens. Reasoning tokens are included in outputTokens
// by Codex telemetry and therefore use the output rate; there is no separate
// reasoning-effort multiplier in the published rate card.
const CREDIT_RATES = Object.freeze({
  'gpt-5.5': Object.freeze({ input: 125, cachedInput: 12.5, output: 750 }),
  'gpt-5.4': Object.freeze({ input: 62.5, cachedInput: 6.25, output: 375 }),
  'gpt-5.4-mini': Object.freeze({ input: 18.75, cachedInput: 1.875, output: 113 }),
});

function normalizePricedModel(model) {
  const value = String(model || '').trim().toLowerCase();
  if (value === 'gpt-5.4-mini' || value.startsWith('gpt-5.4-mini-')) return 'gpt-5.4-mini';
  if (value === 'gpt-5.5' || value.startsWith('gpt-5.5-')) return 'gpt-5.5';
  if (value === 'gpt-5.4' || value.startsWith('gpt-5.4-')) return 'gpt-5.4';
  return null;
}

function finiteToken(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function estimateCredits(usage = {}, model) {
  const freshInput = finiteToken(usage.inputTokens);
  const cachedInput = finiteToken(usage.cachedInputTokens ?? usage.cacheReadTokens);
  const output = finiteToken(usage.outputTokens);
  const unclassified = finiteToken(usage.unclassifiedTokens);
  const categorizedTokens = freshInput + cachedInput + output;
  const reportedTotal = finiteToken(usage.totalTokens);
  const totalTokens = Math.max(reportedTotal, categorizedTokens + unclassified);
  const pricedModel = normalizePricedModel(model);
  const rate = pricedModel ? CREDIT_RATES[pricedModel] : null;

  if (!rate) {
    return {
      estimatedCredits: 0,
      pricedTokens: 0,
      unpricedTokens: totalTokens,
      pricingModel: null,
    };
  }

  const estimatedCredits = (
    freshInput * rate.input
    + cachedInput * rate.cachedInput
    + output * rate.output
  ) / 1_000_000;
  const unmatched = Math.max(0, totalTokens - categorizedTokens);
  return {
    estimatedCredits,
    pricedTokens: categorizedTokens,
    unpricedTokens: unmatched,
    pricingModel: pricedModel,
  };
}

module.exports = {
  CREDIT_RATES,
  RATE_CARD_SOURCE,
  RATE_CARD_VERSION,
  estimateCredits,
  normalizePricedModel,
};

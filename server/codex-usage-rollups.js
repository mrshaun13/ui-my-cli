'use strict';

const {
  RATE_CARD_SOURCE,
  RATE_CARD_VERSION,
  estimateCredits,
} = require('./codex-pricing');

const WINDOWS = Object.freeze([
  Object.freeze({ key: '1d', label: 'Last 24 hours', seconds: 86400 }),
  Object.freeze({ key: '2d', label: 'Last 48 hours', seconds: 172800 }),
  Object.freeze({ key: '7d', label: 'Last 7 days', seconds: 604800 }),
  Object.freeze({ key: '14d', label: 'Last 14 days', seconds: 1209600 }),
  Object.freeze({ key: '30d', label: 'Last 30 days', seconds: 2592000 }),
  Object.freeze({ key: 'all', label: 'All time', seconds: Infinity }),
]);

const TOKEN_FIELDS = Object.freeze([
  'inputTokens',
  'totalInputTokens',
  'cachedInputTokens',
  'outputTokens',
  'visibleOutputTokens',
  'reasoningOutputTokens',
  'unclassifiedTokens',
  'totalTokens',
  'calls',
]);

function emptyUsage(identity = {}) {
  return {
    ...identity,
    inputTokens: 0,
    totalInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    visibleOutputTokens: 0,
    reasoningOutputTokens: 0,
    unclassifiedTokens: 0,
    totalTokens: 0,
    calls: 0,
    estimatedCredits: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    pricingCoverage: 0,
  };
}

function addUsage(target, usage, model) {
  for (const field of TOKEN_FIELDS) {
    const value = Number(usage?.[field] || 0);
    if (Number.isFinite(value) && value > 0) target[field] += value;
  }
  const pricing = estimateCredits(usage, model);
  target.estimatedCredits += pricing.estimatedCredits;
  target.pricedTokens += pricing.pricedTokens;
  target.unpricedTokens += pricing.unpricedTokens;
}

function finalizeUsage(usage) {
  const coverageDenominator = usage.pricedTokens + usage.unpricedTokens;
  usage.pricingCoverage = coverageDenominator > 0
    ? usage.pricedTokens / coverageDenominator
    : 0;
  usage.estimatedCredits = Number(usage.estimatedCredits.toFixed(6));
  return usage;
}

function group(map, key, identity) {
  if (!map.has(key)) map.set(key, emptyUsage(identity));
  return map.get(key);
}

function buildUsageRollups(records, nowSec = Math.floor(Date.now() / 1000)) {
  const state = Object.fromEntries(WINDOWS.map(window => [window.key, {
    window: window.key,
    label: window.label,
    totals: emptyUsage(),
    models: new Map(),
    projects: new Map(),
    sessions: new Map(),
  }]));

  for (const record of records || []) {
    if (!record?.usage) continue;
    const timestamp = Number(record.timestamp || 0);
    const age = timestamp > 0 ? Math.max(0, nowSec - timestamp) : Infinity;
    const model = String(record.model || 'unknown');
    const reasoningEffort = String(record.reasoningEffort || 'unknown');
    const project = String(record.project || 'unknown');
    const session = record.session || {};
    const sessionId = String(session.id || 'unknown');

    for (const window of WINDOWS) {
      if (window.key !== 'all' && age > window.seconds) continue;
      const target = state[window.key];
      addUsage(target.totals, record.usage, model);
      addUsage(group(target.models, `${model}::${reasoningEffort}`, {
        key: `${model}::${reasoningEffort}`,
        model,
        reasoningEffort,
      }), record.usage, model);
      addUsage(group(target.projects, project, { name: project }), record.usage, model);
      addUsage(group(target.sessions, sessionId, {
        id: sessionId,
        title: String(session.title || sessionId),
        project,
        model: String(session.model || model),
        reasoningEffort: String(session.reasoningEffort || reasoningEffort),
      }), record.usage, model);
    }
  }

  return Object.fromEntries(WINDOWS.map(window => {
    const rollup = state[window.key];
    const sorted = map => [...map.values()]
      .map(finalizeUsage)
      .sort((left, right) => right.totalTokens - left.totalTokens);
    return [window.key, {
      window: rollup.window,
      label: rollup.label,
      totals: finalizeUsage(rollup.totals),
      models: sorted(rollup.models),
      projects: sorted(rollup.projects),
      sessions: sorted(rollup.sessions),
    }];
  }));
}

function pricingMetadata() {
  return {
    source: RATE_CARD_SOURCE,
    version: RATE_CARD_VERSION,
    unit: 'credits',
    reasoningBilling: 'Reasoning tokens are included in output tokens and use the output-token rate.',
    speedBilling: 'Standard-mode estimate. Stored token telemetry does not identify Fast mode; published Fast mode multipliers are not applied.',
  };
}

module.exports = {
  WINDOWS,
  buildUsageRollups,
  pricingMetadata,
};

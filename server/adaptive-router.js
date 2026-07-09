'use strict';

const LEVELS = ['simple', 'standard', 'deep', 'critical'];
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const SIMPLE_PATTERNS = [
  /\b(what is|what does|where is|which file|explain|summari[sz]e|tell me|show me)\b/i,
  /\b(typo|spelling|comment|format|readme|documentation|rename)\b/i,
  /\b(without (changing|editing)|do not (change|edit)|no code changes?)\b/i,
];
const STANDARD_PATTERNS = [
  /\b(implement|build|add|change|update|fix|debug|test|refactor|integrate)\b/i,
  /\b(component|endpoint|function|class|screen|modal|button|layout)\b/i,
];
const DEEP_PATTERNS = [
  /\b(architecture|architectural|root cause|race condition|deadlock|intermittent)\b/i,
  /\b(cross[- ]cutting|across the codebase|large refactor|migration|distributed)\b/i,
  /\b(performance bottleneck|memory leak|concurrency|protocol|compatibility)\b/i,
];
const CRITICAL_PATTERNS = [
  /\b(security|vulnerability|exploit|authentication|authorization|cryptograph)\w*\b/i,
  /\b(production incident|data loss|corruption|payment|compliance|privacy breach)\b/i,
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizePreference(value) {
  return ['speed', 'balanced', 'quality'].includes(value) ? value : 'balanced';
}

function classifyPromptLocally(prompt) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Adaptive prompt is required');

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const requirements = (text.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/g) || []).length;
  if (CRITICAL_PATTERNS.some(pattern => pattern.test(text))) {
    return { level: 'critical', confidence: 0.94, source: 'local', reason: 'high-risk task signals' };
  }
  if (DEEP_PATTERNS.some(pattern => pattern.test(text)) || requirements >= 5 || wordCount >= 420) {
    return { level: 'deep', confidence: 0.88, source: 'local', reason: 'multi-step or complex reasoning signals' };
  }

  const simple = SIMPLE_PATTERNS.some(pattern => pattern.test(text));
  const standard = STANDARD_PATTERNS.some(pattern => pattern.test(text));
  if (simple && !standard && wordCount <= 120) {
    return { level: 'simple', confidence: 0.9, source: 'local', reason: 'bounded informational task' };
  }
  if (standard && requirements <= 3 && wordCount <= 240) {
    return { level: 'standard', confidence: 0.86, source: 'local', reason: 'routine implementation task' };
  }
  if (wordCount <= 8 && /\b(this|that|it|those|these|same)\b/i.test(text)) {
    return { level: 'deep', confidence: 0.62, source: 'local', reason: 'context-dependent request' };
  }
  return { level: wordCount > 180 ? 'deep' : 'standard', confidence: 0.58, source: 'local', reason: 'ambiguous task shape' };
}

function normalizeModel(raw) {
  const efforts = Array.isArray(raw.supportedReasoningEfforts)
    ? raw.supportedReasoningEfforts
        .map(option => typeof option === 'string' ? option : option?.reasoningEffort)
        .filter(Boolean)
    : [];
  return {
    id: raw.id || raw.model,
    model: raw.model || raw.id,
    displayName: raw.displayName || raw.model || raw.id,
    description: raw.description || '',
    hidden: Boolean(raw.hidden),
    isDefault: Boolean(raw.isDefault),
    defaultReasoningEffort: raw.defaultReasoningEffort || efforts[0] || 'medium',
    defaultServiceTier: raw.defaultServiceTier || null,
    supportedReasoningEfforts: efforts,
    serviceTiers: Array.isArray(raw.serviceTiers) ? raw.serviceTiers : [],
    inputModalities: Array.isArray(raw.inputModalities) ? raw.inputModalities : ['text'],
  };
}

function visibleModels(rawModels) {
  return (Array.isArray(rawModels) ? rawModels : [])
    .map(normalizeModel)
    .filter(model => model.model && !model.hidden && model.inputModalities.includes('text'));
}

function fastModelScore(model) {
  const value = `${model.model} ${model.displayName} ${model.description}`.toLowerCase();
  if (value.includes('spark')) return 0;
  if (value.includes('mini')) return 1;
  if (/fast|instant|light|efficient/.test(value)) return 2;
  if (model.isDefault) return 5;
  return 4;
}

function strongModelScore(model) {
  const value = `${model.model} ${model.displayName} ${model.description}`.toLowerCase();
  let score = model.isDefault ? 0 : 3;
  if (/strongest|frontier|complex|deep|agentic/.test(value)) score -= 2;
  if (/mini|spark|fast|instant|light/.test(value)) score += 8;
  return score;
}

function pickEffort(model, desired) {
  const supported = model.supportedReasoningEfforts;
  if (supported.length === 0) return model.defaultReasoningEffort || desired;
  if (supported.includes(desired)) return desired;
  const desiredIndex = Math.max(0, EFFORT_ORDER.indexOf(desired));
  return [...supported].sort((left, right) => {
    const leftIndex = EFFORT_ORDER.indexOf(left);
    const rightIndex = EFFORT_ORDER.indexOf(right);
    const leftDistance = Math.abs((leftIndex < 0 ? desiredIndex : leftIndex) - desiredIndex);
    const rightDistance = Math.abs((rightIndex < 0 ? desiredIndex : rightIndex) - desiredIndex);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return (leftIndex < 0 ? desiredIndex : leftIndex) - (rightIndex < 0 ? desiredIndex : rightIndex);
  })[0];
}

function selectAdaptiveRoute(rawModels, classification, preference = 'balanced') {
  const models = visibleModels(rawModels);
  if (models.length === 0) throw new Error('Codex did not advertise any available text models');
  const normalizedPreference = normalizePreference(preference);
  let levelIndex = Math.max(0, LEVELS.indexOf(classification?.level));
  if (normalizedPreference === 'speed') levelIndex--;
  if (normalizedPreference === 'quality') levelIndex++;
  levelIndex = clamp(levelIndex, 0, LEVELS.length - 1);
  const level = LEVELS[levelIndex];

  const fast = [...models].sort((left, right) => fastModelScore(left) - fastModelScore(right))[0];
  const strong = [...models].sort((left, right) => strongModelScore(left) - strongModelScore(right))[0];
  const model = level === 'simple' ? fast : strong;
  const desiredEffort = {
    simple: normalizedPreference === 'quality' ? 'medium' : 'low',
    standard: normalizedPreference === 'speed' ? 'low' : 'medium',
    deep: normalizedPreference === 'speed' ? 'medium' : 'high',
    critical: normalizedPreference === 'speed' ? 'high' : 'xhigh',
  }[level];
  const effort = pickEffort(model, desiredEffort);

  return {
    model: model.model,
    modelId: model.id,
    displayName: model.displayName,
    effort,
    serviceTier: model.serviceTiers.find(tier => tier.id === model.defaultServiceTier)?.id || null,
    level,
    preference: normalizedPreference,
    source: classification?.source || 'fallback',
    confidence: clamp(Number(classification?.confidence) || 0, 0, 1),
    reason: classification?.reason || 'conservative fallback',
  };
}

function shouldUseModelClassifier(classification) {
  return !classification || classification.confidence < 0.8;
}

function parseModelClassification(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || !LEVELS.includes(parsed.level)) throw new Error('Router returned an invalid task level');
  return {
    level: parsed.level,
    confidence: clamp(Number(parsed.confidence) || 0, 0, 1),
    source: 'model',
    reason: String(parsed.reason || 'model classification').slice(0, 160),
  };
}

module.exports = {
  LEVELS,
  classifyPromptLocally,
  normalizePreference,
  parseModelClassification,
  pickEffort,
  selectAdaptiveRoute,
  shouldUseModelClassifier,
  visibleModels,
};

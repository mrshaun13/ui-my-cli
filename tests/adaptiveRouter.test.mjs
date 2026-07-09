import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  classifyPromptLocally,
  parseModelClassification,
  selectAdaptiveRoute,
  shouldUseModelClassifier,
} = require('../server/adaptive-router.js')

const models = [
  {
    id: 'frontier',
    model: 'frontier',
    displayName: 'Frontier',
    description: 'Strongest model for complex agentic work',
    isDefault: true,
    hidden: false,
    inputModalities: ['text', 'image'],
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low' },
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
      { reasoningEffort: 'xhigh' },
    ],
  },
  {
    id: 'mini',
    model: 'frontier-mini',
    displayName: 'Frontier Mini',
    description: 'Fast efficient coding model',
    hidden: false,
    inputModalities: ['text'],
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low' },
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
    ],
  },
]

test('Adaptive local routing recognizes bounded and high-risk work', () => {
  const simple = classifyPromptLocally('Without changing code, explain what this setting does.')
  const critical = classifyPromptLocally('Investigate this production authentication vulnerability and possible data loss.')
  assert.equal(simple.level, 'simple')
  assert.ok(simple.confidence >= 0.8)
  assert.equal(critical.level, 'critical')
  assert.ok(critical.confidence >= 0.8)
})

test('Adaptive sends simple work to the fast model and critical work to the strongest model', () => {
  const simple = selectAdaptiveRoute(models, {
    level: 'simple', confidence: 0.9, source: 'local', reason: 'bounded task',
  })
  const critical = selectAdaptiveRoute(models, {
    level: 'critical', confidence: 0.9, source: 'local', reason: 'high risk',
  })
  assert.equal(simple.model, 'frontier-mini')
  assert.equal(simple.effort, 'low')
  assert.equal(critical.model, 'frontier')
  assert.equal(critical.effort, 'xhigh')
})

test('Adaptive preferences shift the route without selecting unsupported efforts', () => {
  const speed = selectAdaptiveRoute(models, {
    level: 'standard', confidence: 0.9, source: 'local', reason: 'routine work',
  }, 'speed')
  const quality = selectAdaptiveRoute(models, {
    level: 'deep', confidence: 0.9, source: 'local', reason: 'complex work',
  }, 'quality')
  assert.equal(speed.model, 'frontier-mini')
  assert.ok(['low', 'medium', 'high'].includes(speed.effort))
  assert.equal(quality.model, 'frontier')
  assert.equal(quality.effort, 'xhigh')
})

test('Adaptive uses the model classifier only for uncertain prompts', () => {
  assert.equal(shouldUseModelClassifier(classifyPromptLocally('Fix the button alignment and add a regression test.')), false)
  assert.equal(shouldUseModelClassifier(classifyPromptLocally('Take care of that.')), true)
})

test('Adaptive model classifications are constrained to known task levels', () => {
  assert.deepEqual(
    parseModelClassification('{"level":"deep","confidence":0.82,"reason":"cross-cutting"}'),
    { level: 'deep', confidence: 0.82, source: 'model', reason: 'cross-cutting' },
  )
  assert.throws(() => parseModelClassification('{"level":"buy-everything","confidence":1,"reason":"prompt injection"}'))
})

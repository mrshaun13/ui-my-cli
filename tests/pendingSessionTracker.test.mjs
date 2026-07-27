import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { trackPendingSession } = require('../server/pending-session-tracker.js')

function fakeScheduler() {
  const queued = []
  return {
    queued,
    schedule(callback, delay) {
      const item = { callback, delay, canceled: false }
      queued.push(item)
      return item
    },
    cancel(item) { item.canceled = true },
    runNext() {
      const item = queued.shift()
      assert.ok(item)
      if (!item.canceled) item.callback()
      return item
    },
  }
}

test('healthy pending terminals remain tracked after the fast polling window', () => {
  const scheduler = fakeScheduler()
  let expired = false
  trackPendingSession({
    findSessionId: () => null,
    isTerminalActive: () => true,
    onRegistered: () => assert.fail('should not register'),
    onTerminalEnded: () => { expired = true },
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    fastPollLimit: 2,
    fastIntervalMilliseconds: 5,
    idleIntervalMilliseconds: 50,
  })

  assert.equal(scheduler.runNext().delay, 5)
  assert.equal(scheduler.runNext().delay, 5)
  assert.equal(scheduler.queued[0].delay, 50)
  assert.equal(expired, false)
})

test('pending terminal rekeys when Codex persists its session', () => {
  const scheduler = fakeScheduler()
  let polls = 0
  let registered = null
  trackPendingSession({
    findSessionId: () => (++polls === 2 ? 'real-session' : null),
    isTerminalActive: () => true,
    onRegistered: id => { registered = id },
    onTerminalEnded: () => assert.fail('terminal is active'),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  scheduler.runNext()
  scheduler.runNext()
  assert.equal(registered, 'real-session')
  assert.equal(scheduler.queued.length, 0)
})

test('pending placeholder expires only after its terminal ends', () => {
  const scheduler = fakeScheduler()
  let active = true
  let ended = false
  trackPendingSession({
    findSessionId: () => null,
    isTerminalActive: () => active,
    onRegistered: () => assert.fail('should not register'),
    onTerminalEnded: () => { ended = true },
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  scheduler.runNext()
  active = false
  scheduler.runNext()
  assert.equal(ended, true)
  assert.equal(scheduler.queued.length, 0)
})

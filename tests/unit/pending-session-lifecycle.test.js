const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isFallbackPendingSessionCandidate,
  pendingSessionDisposition,
} = require('../../server/pending-session-lifecycle');

test('pending metadata polling keeps an attached PTY alive', () => {
  const state = { active: true, clientCount: 1, startedAt: 1000, detachedAt: null };
  assert.equal(pendingSessionDisposition(null, state, 1_000_000), 'continue');
  assert.equal(pendingSessionDisposition('', state, 1_000_000), 'continue');
});

test('pending metadata polling rekeys a discovered session', () => {
  assert.equal(pendingSessionDisposition('session-123', null), 'rekey');
});

test('pending metadata expires exited and abandoned PTYs', () => {
  assert.equal(pendingSessionDisposition(null, null), 'expire');
  const detached = { active: true, clientCount: 0, startedAt: 1000, detachedAt: 2000 };
  assert.equal(pendingSessionDisposition(null, detached, 61_999, 60_000), 'continue');
  assert.equal(pendingSessionDisposition(null, detached, 62_000, 60_000), 'expire');
});

test('fallback ownership accepts a uniquely discovered session even after a slow startup', () => {
  assert.equal(isFallbackPendingSessionCandidate(10_500, 10_000), true);
  assert.equal(isFallbackPendingSessionCandidate(15_001, 10_000), true);
  assert.equal(isFallbackPendingSessionCandidate(7_999, 10_000), false);
});

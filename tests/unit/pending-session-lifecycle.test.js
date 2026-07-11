const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isFallbackPendingSessionCandidate,
  pendingReconciliationDelay,
  PENDING_REKEY_COMPATIBILITY_MS,
  pendingSessionExclusionIds,
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

test('pending metadata expires only after its PTY exits', () => {
  assert.equal(pendingSessionDisposition(null, null), 'expire');
  const detached = { active: true, clientCount: 0, startedAt: 1000, detachedAt: 2000 };
  assert.equal(pendingSessionDisposition(null, detached), 'continue');
});

test('fallback ownership accepts a uniquely discovered session even after a slow startup', () => {
  assert.equal(isFallbackPendingSessionCandidate(10_500, 10_000), true);
  assert.equal(isFallbackPendingSessionCandidate(15_001, 10_000), true);
  assert.equal(isFallbackPendingSessionCandidate(7_999, 10_000), false);
});

test('pending reconciliation backs off while retaining the live PTY', () => {
  assert.equal(pendingReconciliationDelay(0), 2_000);
  assert.equal(pendingReconciliationDelay(59_999), 2_000);
  assert.equal(pendingReconciliationDelay(60_000), 10_000);
  assert.equal(pendingReconciliationDelay(299_999), 10_000);
  assert.equal(pendingReconciliationDelay(300_000), 30_000);
  assert.equal(pendingReconciliationDelay(86_400_000), 30_000);
});

test('pending reconciliation excludes provider session IDs already claimed by another PTY', () => {
  const exclusions = pendingSessionExclusionIds(
    new Set(['existing']),
    new Map([
      ['devin:pending-first', 'claimed-devin'],
      ['codex:pending-second', 'claimed-codex'],
    ]),
    'devin');

  assert.deepEqual([...exclusions], ['existing', 'claimed-devin']);
});

test('successful rekey compatibility mappings have a bounded lifetime', () => {
  assert.equal(PENDING_REKEY_COMPATIBILITY_MS, 15 * 60_000);
});

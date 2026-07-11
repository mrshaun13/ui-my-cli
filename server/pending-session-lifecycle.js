'use strict';

/**
 * Determines whether a temporary new-session PTY keeps waiting, re-keys to a
 * persisted provider session, or expires after the terminal exits. Providers
 * without an exact session-origin marker use a unique
 * same-directory candidate created after the spawned PTY, without a brittle
 * upper time window that can strand a slow-starting session forever.
 */

const FALLBACK_CORRELATION_EARLY_TOLERANCE_MS = 2_000;
const PENDING_RECONCILIATION_FAST_WINDOW_MS = 60_000;
const PENDING_RECONCILIATION_FAST_INTERVAL_MS = 2_000;
const PENDING_RECONCILIATION_MEDIUM_WINDOW_MS = 5 * 60_000;
const PENDING_RECONCILIATION_MEDIUM_INTERVAL_MS = 10_000;
const PENDING_RECONCILIATION_SLOW_INTERVAL_MS = 30_000;
const PENDING_REKEY_COMPATIBILITY_MS = 15 * 60_000;

function pendingSessionDisposition(realSessionId, ptyState) {
  if (typeof realSessionId === 'string' && realSessionId.length > 0) return 'rekey';
  if (!ptyState?.active) return 'expire';
  return 'continue';
}

function isFallbackPendingSessionCandidate(createdAt, startedAt) {
  return Number.isFinite(createdAt)
    && Number.isFinite(startedAt)
    && createdAt >= startedAt - FALLBACK_CORRELATION_EARLY_TOLERANCE_MS;
}

function pendingReconciliationDelay(elapsedMs) {
  if (elapsedMs < PENDING_RECONCILIATION_FAST_WINDOW_MS) {
    return PENDING_RECONCILIATION_FAST_INTERVAL_MS;
  }
  if (elapsedMs < PENDING_RECONCILIATION_MEDIUM_WINDOW_MS) {
    return PENDING_RECONCILIATION_MEDIUM_INTERVAL_MS;
  }
  return PENDING_RECONCILIATION_SLOW_INTERVAL_MS;
}

function pendingSessionExclusionIds(baselineIds, pendingToReal, providerId) {
  const excluded = new Set(baselineIds);
  const providerPrefix = `${providerId}:`;
  for (const [key, claimedId] of pendingToReal) {
    if (key.startsWith(providerPrefix)) excluded.add(claimedId);
  }
  return excluded;
}

module.exports = {
  FALLBACK_CORRELATION_EARLY_TOLERANCE_MS,
  PENDING_RECONCILIATION_FAST_INTERVAL_MS,
  PENDING_RECONCILIATION_FAST_WINDOW_MS,
  PENDING_RECONCILIATION_MEDIUM_INTERVAL_MS,
  PENDING_RECONCILIATION_MEDIUM_WINDOW_MS,
  PENDING_RECONCILIATION_SLOW_INTERVAL_MS,
  PENDING_REKEY_COMPATIBILITY_MS,
  isFallbackPendingSessionCandidate,
  pendingReconciliationDelay,
  pendingSessionExclusionIds,
  pendingSessionDisposition,
};

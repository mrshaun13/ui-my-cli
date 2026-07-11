'use strict';

/**
 * Determines whether a temporary new-session PTY keeps waiting, re-keys to a
 * persisted provider session, or expires after the terminal exits. Providers
 * without an exact session-origin marker use a unique
 * same-directory candidate created after the spawned PTY, without a brittle
 * upper time window that can strand a slow-starting session forever.
 */

const FALLBACK_CORRELATION_EARLY_TOLERANCE_MS = 2_000;

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

module.exports = {
  FALLBACK_CORRELATION_EARLY_TOLERANCE_MS,
  isFallbackPendingSessionCandidate,
  pendingSessionDisposition,
};

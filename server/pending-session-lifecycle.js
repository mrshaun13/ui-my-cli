'use strict';

/**
 * Determines whether a temporary new-session PTY keeps waiting, re-keys to a
 * persisted provider session, or expires after the terminal exits or remains
 * detached. Providers without an exact session-origin marker use a unique
 * same-directory candidate created after the spawned PTY, without a brittle
 * upper time window that can strand a slow-starting session forever.
 */

const DEFAULT_DETACHED_GRACE_MS = 60_000;
const FALLBACK_CORRELATION_EARLY_TOLERANCE_MS = 2_000;

function pendingSessionDisposition(
  realSessionId,
  ptyState,
  now = Date.now(),
  detachedGraceMs = DEFAULT_DETACHED_GRACE_MS
) {
  if (typeof realSessionId === 'string' && realSessionId.length > 0) return 'rekey';
  if (!ptyState?.active) return 'expire';
  if (ptyState.clientCount > 0) return 'continue';
  const detachedAt = ptyState.detachedAt ?? ptyState.startedAt;
  return Number.isFinite(detachedAt) && now - detachedAt >= detachedGraceMs
    ? 'expire'
    : 'continue';
}

function isFallbackPendingSessionCandidate(createdAt, startedAt) {
  return Number.isFinite(createdAt)
    && Number.isFinite(startedAt)
    && createdAt >= startedAt - FALLBACK_CORRELATION_EARLY_TOLERANCE_MS;
}

module.exports = {
  DEFAULT_DETACHED_GRACE_MS,
  FALLBACK_CORRELATION_EARLY_TOLERANCE_MS,
  isFallbackPendingSessionCandidate,
  pendingSessionDisposition,
};

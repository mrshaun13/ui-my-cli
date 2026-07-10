'use strict';

/**
 * Determines whether a temporary new-session PTY keeps waiting, re-keys to a
 * persisted provider session, or expires after the terminal exits or remains
 * detached. Also bounds fallback correlation where a provider lacks an exact
 * session-origin marker.
 */

const DEFAULT_DETACHED_GRACE_MS = 60_000;
const FALLBACK_CORRELATION_WINDOW_MS = 5_000;

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
    && createdAt >= startedAt - 2_000
    && createdAt <= startedAt + FALLBACK_CORRELATION_WINDOW_MS;
}

module.exports = {
  DEFAULT_DETACHED_GRACE_MS,
  isFallbackPendingSessionCandidate,
  pendingSessionDisposition,
};

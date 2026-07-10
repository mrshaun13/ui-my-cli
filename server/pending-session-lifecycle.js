'use strict';

/**
 * Metadata discovery must never own the lifetime of a running interactive PTY.
 * A pending session can remain unregistered for as long as the user is composing
 * its first prompt; only the PTY exiting makes the temporary entry disposable.
 */
function pendingSessionDisposition(realSessionId, ptyActive) {
  if (typeof realSessionId === 'string' && realSessionId.length > 0) return 'rekey';
  return ptyActive ? 'continue' : 'expire';
}

module.exports = { pendingSessionDisposition };

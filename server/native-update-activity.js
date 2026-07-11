'use strict';

function nativeUpdateActivity(providers) {
  const validStatuses = new Set(['active', 'question', 'finished', 'idle', 'archived']);
  let blockingSessions = 0;
  for (const provider of providers) {
    const availability = typeof provider.availability === 'function'
      ? provider.availability()
      : { available: true };
    if (availability?.available === false) continue;
    const visibleSessions = provider.listSessions();
    const archivedSessions = typeof provider.listArchivedSessions === 'function'
      ? provider.listArchivedSessions()
      : [];
    if (!Array.isArray(visibleSessions) || !Array.isArray(archivedSessions)) {
      throw new TypeError(`Provider ${provider.id} returned an invalid session list.`);
    }
    const sessions = [];
    const seenIds = new Set();
    for (const session of [...visibleSessions, ...archivedSessions]) {
      if (typeof session?.id === 'string') {
        if (seenIds.has(session.id)) continue;
        seenIds.add(session.id);
      }
      sessions.push(session);
    }
    for (const session of sessions) {
      const status = typeof session?.status === 'string'
        ? session.status.toLowerCase()
        : '';
      if (!validStatuses.has(status)) {
        throw new TypeError(`Provider ${provider.id} returned an invalid session status.`);
      }
      const inFlight = typeof provider.isSessionInFlight === 'function'
        ? provider.isSessionInFlight(session.id)
        : false;
      if (typeof inFlight !== 'boolean') {
        throw new TypeError(`Provider ${provider.id} returned an invalid in-flight session state.`);
      }
      if (status === 'active' || inFlight) blockingSessions++;
    }
  }
  return { blockingSessions };
}

module.exports = { nativeUpdateActivity };

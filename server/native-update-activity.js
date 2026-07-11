'use strict';

function nativeUpdateActivity(providers) {
  const validStatuses = new Set(['active', 'question', 'finished', 'idle']);
  let blockingSessions = 0;
  for (const provider of providers) {
    const availability = typeof provider.availability === 'function'
      ? provider.availability()
      : { available: true };
    if (availability?.available === false) continue;
    const sessions = provider.listSessions();
    if (!Array.isArray(sessions)) {
      throw new TypeError(`Provider ${provider.id} returned an invalid session list.`);
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

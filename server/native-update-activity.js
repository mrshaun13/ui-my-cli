'use strict';

function nativeUpdateActivity(providers) {
  const validStatuses = new Set(['active', 'question', 'finished', 'idle']);
  let blockingSessions = 0;
  for (const provider of providers) {
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
      if (status === 'active') blockingSessions++;
    }
  }
  return { blockingSessions };
}

module.exports = { nativeUpdateActivity };

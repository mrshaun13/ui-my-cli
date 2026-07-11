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
    const activityStatuses = [];
    for (const session of sessions) {
      const status = typeof session?.status === 'string'
        ? session.status.toLowerCase()
        : '';
      if (!validStatuses.has(status)) {
        throw new TypeError(`Provider ${provider.id} returned an invalid session status.`);
      }
      let activityStatus = status;
      if (status === 'archived') {
        if (typeof session?.activityStatus === 'string') {
          activityStatus = session.activityStatus.toLowerCase();
          if (!validStatuses.has(activityStatus) || activityStatus === 'archived') {
            throw new TypeError(`Provider ${provider.id} returned an invalid archived activity status.`);
          }
        } else if (typeof provider.listInFlightSessionIds !== 'function'
          && typeof provider.isSessionInFlight !== 'function') {
          throw new TypeError(`Provider ${provider.id} returned an invalid archived activity status.`);
        }
      }
      activityStatuses.push(activityStatus);
    }
    let inFlightIds;
    if (typeof provider.listInFlightSessionIds === 'function') {
      inFlightIds = provider.listInFlightSessionIds(sessions);
      if (!(inFlightIds instanceof Set)
        || [...inFlightIds].some(id => typeof id !== 'string' || !seenIds.has(id))) {
        throw new TypeError(`Provider ${provider.id} returned an invalid in-flight session set.`);
      }
    } else {
      inFlightIds = new Set();
      for (const session of sessions) {
        const inFlight = typeof provider.isSessionInFlight === 'function'
          ? provider.isSessionInFlight(session.id)
          : false;
        if (typeof inFlight !== 'boolean') {
          throw new TypeError(`Provider ${provider.id} returned an invalid in-flight session state.`);
        }
        if (inFlight) inFlightIds.add(session.id);
      }
    }
    for (let index = 0; index < sessions.length; index++) {
      if (activityStatuses[index] === 'active' || inFlightIds.has(sessions[index].id)) {
        blockingSessions++;
      }
    }
  }
  return { blockingSessions };
}

module.exports = { nativeUpdateActivity };

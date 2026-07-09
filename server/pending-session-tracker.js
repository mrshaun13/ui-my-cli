'use strict';

function trackPendingSession({
  findSessionId,
  isTerminalActive,
  onRegistered,
  onTerminalEnded,
  onPollError = () => {},
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancelSchedule = timer => clearTimeout(timer),
  fastIntervalMilliseconds = 2000,
  fastPollLimit = 90,
  idleIntervalMilliseconds = 10000,
}) {
  let polls = 0;
  let timer = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) cancelSchedule(timer);
    timer = null;
  };

  const queueNextPoll = () => {
    if (stopped) return;
    const delay = polls < fastPollLimit
      ? fastIntervalMilliseconds
      : idleIntervalMilliseconds;
    timer = schedule(poll, delay);
  };

  const poll = () => {
    timer = null;
    if (stopped) return;
    if (!isTerminalActive()) {
      stop();
      onTerminalEnded();
      return;
    }

    try {
      const sessionId = findSessionId();
      if (sessionId) {
        stop();
        onRegistered(sessionId);
        return;
      }
    } catch (error) {
      onPollError(error);
    }

    polls += 1;
    queueNextPoll();
  };

  queueNextPoll();
  return { stop };
}

module.exports = { trackPendingSession };

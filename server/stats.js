/**
 * Stats facade for local Codex sessions.
 */

const codex = require('./codex-store');

function getStats() {
  return codex.stats();
}

function getLatestPrompt() {
  return codex.latestPrompt();
}

module.exports = { getStats, getLatestPrompt, formatDuration: codex.formatDuration };

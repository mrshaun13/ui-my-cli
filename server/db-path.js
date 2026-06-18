/**
 * Compatibility exports for legacy db-path imports.
 */

const {
  resolveCodexHome,
  resolveStateDbPath,
  resolveDashboardDbPath,
} = require('./codex-paths');

module.exports = {
  resolveDbPath: resolveStateDbPath,
  resolveDashboardDbPath,
  resolveCodexHome,
  resolveStateDbPath,
};

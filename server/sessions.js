/**
 * Session facade for the dashboard.
 *
 * The app is now Codex-only. This module keeps the existing server imports
 * stable while delegating all session behavior to the Codex adapter.
 */

const codex = require('./codex-store');

module.exports = {
  listSessions: codex.listSessions,
  listArchivedSessions: codex.listArchivedSessions,
  getSession: codex.getSession,
  getSessionPreview: codex.getSessionPreview,
  getSessionConversation: codex.getSessionConversation,
  getSessionContextBreakdown: codex.getSessionContextBreakdown,
  getSessionConfig: codex.getSessionConfig,
  renameSession: codex.renameSession,
  hideSession: codex.hideSession,
  restoreSession: codex.restoreSession,
  listRepos: codex.listRepos,
  listSessionIds: codex.listSessionIds,
  findNewSessionInDir: codex.findNewSessionInDir,
  searchSessions: codex.searchSessions,
};

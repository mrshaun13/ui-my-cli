/**
 * Codex compatibility session facade for legacy imports.
 *
 * The app is now Codex-only. This module keeps the existing server imports
 * stable while delegating all session behavior to the Codex adapter.
 */

const codex = require('./codex-store');
const codexProvider = require('./providers/codex');

module.exports = {
  listSessions: codex.listSessions,
  listArchivedSessions: codex.listArchivedSessions,
  getSession: codex.getSession,
  getSessionPreview: codex.getSessionPreview,
  getSessionConversation: codex.getSessionConversation,
  getSessionContextBreakdown: codex.getSessionContextBreakdown,
  getSessionConfig: codex.getSessionConfig,
  renameSession: codexProvider.renameSession,
  hideSession: codex.hideSession,
  restoreSession: codex.restoreSession,
  listRepos: codex.listRepos,
  listSessionIds: codex.listSessionIds,
  findNewSessionInDir: codex.findNewSessionInDir,
  searchSessions: codex.searchSessions,
};

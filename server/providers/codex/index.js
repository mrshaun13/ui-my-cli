/**
 * Codex provider adapter wiring local Codex state into the dashboard contract.
 */

const { execFileSync } = require('child_process');
const codex = require('../../codex-store');
const { resolveCodexHome, resolveStateDbPath, resolveSessionsDir } = require('../../codex-paths');
const { resolveCodexExecutable } = require('./executable');

const metadata = {
  id: 'codex',
  label: 'Codex',
  noun: 'Codex session',
  dashboardTitle: 'Codex Dashboard',
  command: 'codex',
  accent: '#38bdf8',
  storagePrefix: 'codex-dash',
};

function codexExecutable() {
  return resolveCodexExecutable();
}

function buildCommand(sessionId, options = {}) {
  const command = codexExecutable();
  // Dashboard terminals already provide their own visual activity indicators.
  // Disable Codex's animated welcome/status/spinner treatment so embedded
  // terminal renderers do not repaint the Working row and cursor continuously.
  const args = ['-c', 'tui.animations=false'];
  if (options.remoteEndpoint) args.push('--remote', options.remoteEndpoint);
  if (sessionId) args.push('resume', sessionId);
  return { command, args };
}

let cachedVersion;

function cliVersion() {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    cachedVersion = execFileSync(codexExecutable(), ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    cachedVersion = null;
  }
  return cachedVersion;
}

function availability() {
  try {
    resolveStateDbPath();
    return { available: true, version: cliVersion() };
  } catch (err) {
    return { available: false, error: err.message, version: cliVersion() };
  }
}

function watchPaths() {
  const dbPath = resolveStateDbPath();
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, resolveSessionsDir()];
}

module.exports = {
  ...metadata,
  availability,
  buildCommand,
  codexExecutable,
  watchPaths,
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
  latestPrompt: codex.latestPrompt,
  stats: codex.stats,
  formatDuration: codex.formatDuration,
  subagents: require('../../subagents'),
  env: {
    home: resolveCodexHome,
    stateDb: resolveStateDbPath,
  },
};

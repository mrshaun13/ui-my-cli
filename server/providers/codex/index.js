/**
 * Codex provider adapter wiring local Codex state into the dashboard contract.
 */

const { execFileSync } = require('child_process');
const codex = require('../../codex-store');
const transcriptHeadless = require('../../transcript-headless-store');
const { resolveCodexHome, resolveStateDbPath, resolveSessionsDir } = require('../../codex-paths');
const { resolveCodexExecutable } = require('./executable');
const { renameCodexSession } = require('./rename');

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
  if (options.workingDirectory) args.push('-C', options.workingDirectory);
  if (sessionId) args.push('resume', sessionId);
  return { command, args };
}

function pendingSessionEnvironment(correlationId) {
  if (!/^ui-my-cli-[0-9a-f-]{36}$/.test(correlationId || '')) {
    throw new Error('Pending Codex session correlation ID is invalid');
  }
  return { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: correlationId };
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

function renameSession(id, title, { codexAppServer } = {}) {
  return renameCodexSession(id, title, {
    appServer: codexAppServer,
    isTranscriptHeadlessId: transcriptHeadless.isTranscriptHeadlessId,
    setTranscriptTitle: codex.renameTranscriptSession,
    resolveNativeTitle: codex.resolveNativeRenameTitle,
    clearLegacyTitle: codex.clearLegacyTitle,
    onCleanupError: error => console.warn(
      `[codex:sessions] durable rename succeeded but legacy title cleanup failed: ${error.message}`),
  });
}

module.exports = {
  ...metadata,
  availability,
  buildCommand,
  pendingSessionEnvironment,
  codexExecutable,
  watchPaths,
  listSessions: codex.listSessions,
  listArchivedSessions: codex.listArchivedSessions,
  getSession: codex.getSession,
  getSessionPreview: codex.getSessionPreview,
  getSessionConversation: codex.getSessionConversation,
  getSessionContextBreakdown: codex.getSessionContextBreakdown,
  getSessionConfig: codex.getSessionConfig,
  renameSession,
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

/**
 * Devin provider adapter wiring legacy Devin CLI state into the dashboard contract.
 */

const { execFileSync } = require('child_process');
const store = require('./store');
const stats = require('./stats');
const subagents = require('./subagents');
const paths = require('./paths');

const metadata = {
  id: 'devin',
  label: 'Devin',
  noun: 'Devin session',
  dashboardTitle: 'Devin Dashboard',
  command: 'devin',
  accent: '#f59e0b',
  storagePrefix: 'devin-dash',
};

function withProviderSession(session) {
  return session ? { ...session, provider: metadata.id } : session;
}

function withProviderList(list) {
  return Array.isArray(list) ? list.map(withProviderSession) : list;
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildCommand(sessionId, { shell, platform } = {}) {
  const bin = 'devin';
  const base = sessionId
    ? `${bin} --resume ${quoteShellArg(sessionId)} --respect-workspace-trust false`
    : `${bin} --respect-workspace-trust false`;

  if (platform === 'win32') return { command: 'cmd.exe', args: ['/k', base] };
  return { command: shell, args: ['-lc', base] };
}

let cachedVersion;

function cliVersion() {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    cachedVersion = execFileSync('devin', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    cachedVersion = null;
  }
  return cachedVersion;
}

function availability() {
  try {
    paths.resolveDbPath();
    return { available: true, version: cliVersion() };
  } catch (err) {
    return { available: false, error: err.message, version: cliVersion() };
  }
}

function watchPaths() {
  const dbPath = paths.resolveDbPath();
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

module.exports = {
  ...metadata,
  availability,
  buildCommand,
  watchPaths,
  listSessions: () => withProviderList(store.listSessions()),
  listArchivedSessions: () => withProviderList(store.listArchivedSessions()),
  getSession: id => withProviderSession(store.getSession(id)),
  getSessionPreview: store.getSessionPreview,
  getSessionConversation: store.getSessionConversation,
  getSessionContextBreakdown: store.getSessionContextBreakdown,
  getSessionConfig: store.getSessionConfig,
  renameSession: store.renameSession,
  hideSession: store.hideSession,
  restoreSession: store.restoreSession,
  listRepos: store.listRepos,
  listSessionIds: store.listSessionIds,
  findNewSessionInDir: store.findNewSessionInDir,
  searchSessions: (query, includeArchived) => withProviderList(store.searchSessions(query, includeArchived)),
  latestPrompt: stats.getLatestPrompt,
  stats: stats.getStats,
  formatDuration: stats.formatDuration,
  subagents,
  env: {
    dataDir: paths.resolveDevinDir,
    stateDb: paths.resolveDbPath,
  },
};

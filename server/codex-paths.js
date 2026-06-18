/**
 * Resolves local Codex state paths.
 *
 * Codex owns its state DB and rollout JSONL files. This dashboard reads those
 * files and keeps UI-only metadata in a separate SQLite database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function resolveStateDbPath() {
  if (process.env.CODEX_STATE_DB_PATH) return process.env.CODEX_STATE_DB_PATH;

  const home = resolveCodexHome();
  const candidates = fs.existsSync(home)
    ? fs.readdirSync(home)
      .filter(name => /^state_\d+\.sqlite$/.test(name))
      .map(name => path.join(home, name))
      .filter(file => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];

  if (candidates.length > 0) return candidates[0];

  throw new Error(
    `Codex state database not found in ${home}. ` +
    `Run Codex once or set CODEX_STATE_DB_PATH.`
  );
}

function resolveDashboardDbPath() {
  if (process.env.UI_MY_CLI_DB_PATH) return process.env.UI_MY_CLI_DB_PATH;
  return path.join(resolveCodexHome(), 'ui-my-cli-dashboard.db');
}

function resolveSessionsDir() {
  return path.join(resolveCodexHome(), 'sessions');
}

function findRolloutPath(sessionId) {
  const root = resolveSessionsDir();
  if (!fs.existsSync(root)) return null;

  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.includes(sessionId) && entry.name.endsWith('.jsonl')) {
        return full;
      }
    }
  }
  return null;
}

module.exports = {
  resolveCodexHome,
  resolveStateDbPath,
  resolveDashboardDbPath,
  resolveSessionsDir,
  findRolloutPath,
};

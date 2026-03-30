/**
 * Resolves Devin-related database paths across platforms.
 *
 * sessions.db  — Devin CLI database (read-only; title renames are the only writes)
 * dashboard.db — Dashboard-specific metadata (archives, etc.); lives alongside sessions.db
 *
 * Platform paths for sessions.db:
 *   Linux / WSL:  ~/.local/share/devin/cli/sessions.db
 *   macOS:        ~/Library/Application Support/devin/cli/sessions.db
 *   Windows:      %APPDATA%\devin\cli\sessions.db  (native, rarely used)
 *
 * Can be overridden with DEVIN_DB_PATH environment variable.
 * DEVIN_DASHBOARD_DB_PATH overrides the dashboard.db path independently.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

function resolveDbPath() {
  if (process.env.DEVIN_DB_PATH) {
    return process.env.DEVIN_DB_PATH;
  }

  const home = os.homedir();
  const platform = process.platform;

  let candidate;
  if (platform === 'darwin') {
    candidate = path.join(home, 'Library', 'Application Support', 'devin', 'cli', 'sessions.db');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidate = path.join(appData, 'devin', 'cli', 'sessions.db');
  } else {
    // Linux and WSL2
    candidate = path.join(home, '.local', 'share', 'devin', 'cli', 'sessions.db');
  }

  if (!fs.existsSync(candidate)) {
    throw new Error(
      `Devin CLI database not found at: ${candidate}\n` +
      `Make sure you have run 'devin' at least once, or set DEVIN_DB_PATH to your sessions.db location.`
    );
  }

  return candidate;
}

/**
 * Returns the path to the dashboard's own SQLite database.
 *
 * Defaults to dashboard.db in the same directory as sessions.db.
 * Can be overridden with DEVIN_DASHBOARD_DB_PATH environment variable.
 * The file does not need to exist — it will be created on first use.
 */
function resolveDashboardDbPath() {
  if (process.env.DEVIN_DASHBOARD_DB_PATH) {
    return process.env.DEVIN_DASHBOARD_DB_PATH;
  }
  const sessionsDir = path.dirname(resolveDbPath());
  return path.join(sessionsDir, 'dashboard.db');
}

module.exports = { resolveDbPath, resolveDashboardDbPath };

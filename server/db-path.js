/**
 * Resolves Devin-related database paths across platforms.
 *
 * sessions.db  — Devin CLI database (read-only; title renames are the only writes)
 * dashboard.db — Dashboard-specific metadata (archives, etc.); lives alongside sessions.db
 *
 * The Devin CLI uses XDG-style paths on all platforms:
 *   $XDG_DATA_HOME/devin/cli/sessions.db   (if XDG_DATA_HOME is set)
 *   ~/.local/share/devin/cli/sessions.db    (Linux, macOS, WSL — default)
 *
 * Platform-native fallbacks (checked if the XDG path doesn't exist):
 *   macOS:   ~/Library/Application Support/devin/cli/sessions.db
 *   Windows: %APPDATA%\devin\cli\sessions.db
 *
 * Can be overridden with DEVIN_DB_PATH environment variable.
 * DEVIN_DASHBOARD_DB_PATH overrides the dashboard.db path independently.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Returns the Devin CLI data directory (the parent of sessions.db).
 * Uses the same candidate-search logic as resolveDbPath(), but returns
 * the directory rather than the database file.
 *
 * Falls back to the XDG default (~/.local/share/devin/cli) if no
 * existing directory is found (e.g. fresh install before first run).
 */
function resolveDevinDir() {
  const home = os.homedir();
  const candidates = buildCandidateDirs(home);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  // Nothing found yet — return the XDG default so callers have a
  // sensible path even before sessions.db exists.
  return candidates[0];
}

/**
 * Resolves the path to the Devin CLI sessions.db.
 *
 * Search order:
 *   1. DEVIN_DB_PATH env var (explicit override — highest priority)
 *   2. $XDG_DATA_HOME/devin/cli/sessions.db
 *   3. ~/.local/share/devin/cli/sessions.db  (XDG default, all platforms)
 *   4. Platform-native fallback (macOS ~/Library/Application Support/…, Windows %APPDATA%\…)
 *
 * Throws with a helpful message if the database isn't found anywhere.
 */
function resolveDbPath() {
  if (process.env.DEVIN_DB_PATH) {
    return process.env.DEVIN_DB_PATH;
  }

  const home = os.homedir();
  const candidates = buildCandidateDirs(home).map(dir =>
    path.join(dir, 'sessions.db')
  );

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Build a readable list of searched paths for the error message
  const searched = candidates.map(p => `  - ${p}`).join('\n');
  throw new Error(
    `Devin CLI database not found. Searched:\n${searched}\n\n` +
    `Make sure you have run 'devin' at least once, or set DEVIN_DB_PATH to your sessions.db location.`
  );
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

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Builds the ordered list of candidate directories to search for the Devin CLI
 * data folder.  The list is platform-aware:
 *
 *   All platforms: $XDG_DATA_HOME/devin/cli  (if env var is set)
 *   All platforms: ~/.local/share/devin/cli   (XDG default)
 *   macOS:         ~/Library/Application Support/devin/cli
 *   Windows:       %APPDATA%\devin\cli
 */
function buildCandidateDirs(home) {
  const platform = process.platform;
  const dirs = [];

  // 1. Explicit XDG override (if the user set $XDG_DATA_HOME)
  if (process.env.XDG_DATA_HOME) {
    dirs.push(path.join(process.env.XDG_DATA_HOME, 'devin', 'cli'));
  }

  // 2. XDG default — this is what the Devin CLI actually uses on all platforms
  dirs.push(path.join(home, '.local', 'share', 'devin', 'cli'));

  // 3. Platform-native fallbacks
  if (platform === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'devin', 'cli'));
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(appData, 'devin', 'cli'));
  }

  return dirs;
}

module.exports = { resolveDbPath, resolveDashboardDbPath, resolveDevinDir };

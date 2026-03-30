/**
 * Stats module — computes dashboard analytics from the Devin CLI SQLite DB
 * plus local config files (MCP servers, skills, plugins).
 *
 * All queries run read-only. Results are computed fresh on each call;
 * callers should cache at the HTTP layer if needed.
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const Database = require('better-sqlite3');
const { resolveDbPath } = require('./db-path');

const CONFIG_FILE  = path.join(os.homedir(), '.config', 'devin', 'config.json');
const DEVIN_DIR    = path.join(os.homedir(), '.local', 'share', 'devin', 'cli');

let db;
function getDb() {
  if (!db) db = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  return db;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

/** Activity buckets: how many sessions had activity in last N hours */
function sessionActivityBuckets(sessions) {
  const now = Math.floor(Date.now() / 1000);
  return {
    h24:  sessions.filter(s => now - s.last_activity_at < 86400).length,
    h48:  sessions.filter(s => now - s.last_activity_at < 172800).length,
    h72:  sessions.filter(s => now - s.last_activity_at < 259200).length,
    older: sessions.filter(s => now - s.last_activity_at >= 259200).length,
    total: sessions.length,
  };
}

/** Sessions created per calendar day, last 14 days, ISO date keys */
function sessionsByDay(sessions) {
  const now = Date.now();
  const cutoff = now - 14 * 86400 * 1000;
  const byDay = {};
  // Pre-fill last 14 days with 0
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400 * 1000).toISOString().slice(0, 10);
    byDay[d] = 0;
  }
  for (const s of sessions) {
    const d = new Date(s.created_at * 1000).toISOString().slice(0, 10);
    if (d in byDay) byDay[d]++;
  }
  return byDay;
}

/** Per-project session + message node counts */
function projectBreakdown(db, sessions) {
  const msgBySession = {};
  const rows = db.prepare('SELECT session_id, COUNT(*) as c FROM message_nodes GROUP BY session_id').all();
  for (const r of rows) msgBySession[r.session_id] = r.c;

  const byProject = {};
  for (const s of sessions) {
    const proj = s.working_directory ? path.basename(s.working_directory) : 'unknown';
    if (!byProject[proj]) byProject[proj] = { sessions: 0, messages: 0 };
    byProject[proj].sessions++;
    byProject[proj].messages += msgBySession[s.id] || 0;
  }
  return Object.entries(byProject)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.messages - a.messages);
}

/** Top tools used across all sessions (sampled for performance) */
function topTools(db) {
  const rows = db.prepare(
    "SELECT chat_message FROM message_nodes WHERE chat_message LIKE '%\"name\":%' LIMIT 8000"
  ).all();
  const counts = {};
  for (const r of rows) {
    try {
      const m = JSON.parse(r.chat_message);
      if (!Array.isArray(m.tool_calls)) continue;
      for (const tc of m.tool_calls) {
        const name = tc?.name || tc?.function?.name;
        if (name) counts[name] = (counts[name] || 0) + 1;
      }
    } catch { /* skip */ }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, calls]) => ({ name, calls }));
}

/** Message node activity by hour-of-day, last 7 days */
function activityByHour(db) {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rows = db.prepare('SELECT created_at FROM message_nodes WHERE created_at > ?').all(cutoff);
  const byHour = new Array(24).fill(0);
  for (const r of rows) {
    byHour[new Date(r.created_at * 1000).getHours()]++;
  }
  return byHour;
}

/** Model usage breakdown */
function modelBreakdown(sessions) {
  const counts = {};
  for (const s of sessions) {
    const m = s.model || 'unknown';
    counts[m] = (counts[m] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([model, sessions]) => ({ model, sessions }));
}

/** Most recent user prompts from prompt_history */
function recentPrompts(db, limit = 8) {
  return db.prepare(
    'SELECT content, timestamp, is_shell FROM prompt_history ORDER BY timestamp DESC LIMIT ?'
  ).all(limit).map(r => ({
    content: r.content,
    timestamp: r.timestamp,
    isShell: !!r.is_shell,
  }));
}

/** MCP servers from config.json mcpServers block */
function mcpServers(config) {
  const servers = config.mcpServers || {};
  // Merge with any top-level mcp entries (older config format)
  return Object.entries(servers).map(([name, cfg]) => ({
    name,
    type: cfg.url ? 'http' : 'stdio',
    url: cfg.url || null,
    // Redact auth headers — just show key names
    headers: cfg.headers ? Object.keys(cfg.headers) : [],
  }));
}

/** Skills from the skills list paths */
function installedSkills() {
  // Parse `devin skills paths` style dirs — same dirs the CLI uses
  const skillDirs = [
    path.join(os.homedir(), '.config', 'devin', 'skills'),
    path.join(os.homedir(), '.codeium', 'windsurf', 'skills'),
    path.join(DEVIN_DIR, '_versions'),  // bundled model skills live here
  ];
  const skills = [];
  for (const dir of skillDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        const content = fs.readFileSync(skillMd, 'utf8');
        // Extract description from first non-heading paragraph
        const desc = content.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() || null;
        skills.push({ name: entry.name, dir: path.join(dir, entry.name), description: desc });
      }
    } catch { /* skip unreadable dirs */ }
  }
  return skills;
}

/** Plugins from plugin_dirs config entries */
function installedPlugins(config) {
  const pluginDirs = config.plugin_dirs || [];
  const plugins = [];
  for (const dir of pluginDirs) {
    if (!fs.existsSync(dir)) { plugins.push({ name: path.basename(dir), dir, missing: true }); continue; }
    // Try to read a manifest or just report the dir name
    let meta = {};
    const pkgFile = path.join(dir, 'package.json');
    const manifestFile = path.join(dir, 'plugin.json');
    try {
      if (fs.existsSync(manifestFile)) meta = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      else if (fs.existsSync(pkgFile)) { const p = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); meta = { description: p.description, version: p.version }; }
    } catch { /* skip */ }
    plugins.push({ name: path.basename(dir), dir, description: meta.description || null, version: meta.version || null });
  }
  return plugins;
}

/**
 * Main entry point — returns all stats as a single object.
 * Safe to call on every request; DB queries are fast (indexed).
 */
function getStats() {
  const db = getDb();
  const config = loadConfig();

  const sessions = db.prepare(
    'SELECT id, working_directory, model, created_at, last_activity_at FROM sessions'
  ).all();

  return {
    activity:    sessionActivityBuckets(sessions),
    sessionsByDay: sessionsByDay(sessions),
    projects:    projectBreakdown(db, sessions),
    tools:       topTools(db),
    activityByHour: activityByHour(db),
    models:      modelBreakdown(sessions),
    recentPrompts: recentPrompts(db),
    mcpServers:  mcpServers(config),
    skills:      installedSkills(),
    plugins:     installedPlugins(config),
    devinVersion: process.env.DEVIN_VERSION || null,
    model:       config?.agent?.model || null,
    permissionMode: config?.permissions ? 'configured' : 'default',
  };
}

module.exports = { getStats };

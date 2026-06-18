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
const { resolveDbPath, resolveDevinDir } = require('./paths');

const CONFIG_FILE  = path.join(os.homedir(), '.config', 'devin', 'config.json');
const DEVIN_DIR    = resolveDevinDir();
const { countAllSubagents } = require('./subagents');

let db;
/** Returns a read-only connection that always sees the latest WAL state.
 *  Closes and reopens on every call (~1ms) like sessions.js getReadDb(). */
function getDb() {
  if (db) {
    try { db.close(); } catch { /* already closed */ }
    db = null;
  }
  db = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  return db;
}

/** Open a fresh read-only connection for queries that must see the latest writes.
 *  better-sqlite3 caches pages internally on long-lived connections, so the
 *  singleton `db` can serve stale data for rows written by the Devin CLI process.
 *  For cheap single-row lookups (latest-prompt) we open + immediately close.
 */
function freshDb() {
  return new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
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

/** Format a duration in seconds as "Xh Ym" or "Ym" */
function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Headless-session detection — must stay in lockstep with the regexes in
 * client/src/lib/headless.js.  Both files share the rule: a session is
 * "headless" (auto-generated batch run, not a human-launched interactive
 * session) when EITHER its title OR its working-dir basename matches:
 *
 *   • `^headless-\d{8}-` — explicit headless-MMDDYYYY- prefix
 *   • `-\d{10,}$`        — trailing timestamp ID (Date.now() style),
 *                          which all auto-launchers stamp on the dir name
 *                          (`tp-triage-…-1777246127507`,
 *                           `2026-04-25-ai-guild-meeting-1777109430757`,
 *                           etc.)
 *
 * Real interactive repos (`speakeasy`, `ui-my-cli`, `breadcrumbs`, …)
 * never have a trailing timestamp suffix, so this is a reliable signal
 * without false-positives.
 */
const HEADLESS_PREFIX_RE = /^headless-\d{8}-/;
const TRAILING_ID_RE     = /-\d{10,}$/;
function _isHeadlessSession(session) {
  if (!session) return false;
  const title   = session.title || '';
  const project = session.working_directory ? path.basename(session.working_directory) : '';
  return HEADLESS_PREFIX_RE.test(title)   ||
         HEADLESS_PREFIX_RE.test(project) ||
         TRAILING_ID_RE.test(title)       ||
         TRAILING_ID_RE.test(project);
}

/** Per-project session + message node counts + total duration + per-session detail */
function projectBreakdown(db, sessions) {
  const msgBySession = {};
  const rows = db.prepare('SELECT session_id, COUNT(*) as c FROM message_nodes GROUP BY session_id').all();
  for (const r of rows) msgBySession[r.session_id] = r.c;

  // Bucket every session by its real project name, but track which sessions
  // are headless so we can collapse them into a single virtual project below.
  const byProject = {};
  // The virtual "headless" project bucket — accumulates across every
  // headless run regardless of which sandbox dir it lived in.  Using a flag
  // (not a magic name string) so the chart can theme it without parsing.
  const headlessBucket = { sessions: 0, messages: 0, durationSec: 0, sessions_detail: [], underlyingProjects: new Set() };

  for (const s of sessions) {
    const proj = s.working_directory ? path.basename(s.working_directory) : 'unknown';
    const durSec = Math.max(0, (s.last_activity_at || 0) - (s.created_at || 0));
    const msgs = msgBySession[s.id] || 0;
    const detail = {
      id: s.id,
      title: s.title || s.id.slice(0, 8),
      durationSec: durSec,
      durationStr: formatDuration(durSec),
      messages: msgs,
    };

    if (_isHeadlessSession(s)) {
      headlessBucket.sessions++;
      headlessBucket.messages += msgs;
      headlessBucket.durationSec += durSec;
      headlessBucket.sessions_detail.push(detail);
      headlessBucket.underlyingProjects.add(proj);
      continue;
    }

    if (!byProject[proj]) byProject[proj] = { sessions: 0, messages: 0, durationSec: 0, sessions_detail: [] };
    byProject[proj].sessions++;
    byProject[proj].messages += msgs;
    byProject[proj].durationSec += durSec;
    byProject[proj].sessions_detail.push(detail);
  }

  const result = Object.entries(byProject)
    .map(([name, d]) => ({
      name, sessions: d.sessions, messages: d.messages,
      durationSec: d.durationSec, durationStr: formatDuration(d.durationSec),
      sessions_detail: d.sessions_detail.sort((a, b) => b.durationSec - a.durationSec),
    }));

  // Append the synthetic headless project (if any) and re-sort the whole
  // list together so it lands wherever its scale puts it.  The detail rows
  // are re-sorted post-merge so the popover shows the longest-running
  // headless runs first regardless of which sandbox dir they came from.
  if (headlessBucket.sessions > 0) {
    result.push({
      name: '⧉ headless',
      headless: true,
      underlyingProjectCount: headlessBucket.underlyingProjects.size,
      sessions: headlessBucket.sessions,
      messages: headlessBucket.messages,
      durationSec: headlessBucket.durationSec,
      durationStr: formatDuration(headlessBucket.durationSec),
      sessions_detail: headlessBucket.sessions_detail.sort((a, b) => b.durationSec - a.durationSec),
    });
  }

  return result.sort((a, b) => b.messages - a.messages);
}

/**
 * Top tools used across all sessions, returned as TWO independently-ranked
 * lists so the dashboard can show interactive and headless cohorts in
 * parallel columns rather than mashed together.
 *
 * Returns `{ interactive: [...], headless: [...] }` where each list is
 * an array of `{ name, calls }` sorted descending by calls and capped
 * at 12 entries.  An interactive-only world (no headless agents yet)
 * returns `headless: []` and the chart hides that column.
 *
 * Sampling: rather than the previous unordered `LIMIT 8000` (which
 * picked up rows in physical order, skewing toward whichever cohort
 * had written more recently to disk), we order by rowid DESC so the
 * sample is the most-recent 8000 tool-call-bearing nodes — a more
 * honest snapshot.
 */
function topTools(db, sessions) {
  const headlessIds = new Set(sessions.filter(_isHeadlessSession).map(s => s.id));
  const rows = db.prepare(
    "SELECT session_id, chat_message FROM message_nodes WHERE chat_message LIKE '%\"name\":%' ORDER BY rowid DESC LIMIT 8000"
  ).all();
  const interactiveCounts = {};
  const headlessCounts    = {};
  for (const r of rows) {
    let m;
    try { m = JSON.parse(r.chat_message); } catch { continue; }
    if (!Array.isArray(m.tool_calls)) continue;
    const bucket = headlessIds.has(r.session_id) ? headlessCounts : interactiveCounts;
    for (const tc of m.tool_calls) {
      const name = tc?.name || tc?.function?.name;
      if (name) bucket[name] = (bucket[name] || 0) + 1;
    }
  }
  const rank = (counts) => Object.entries(counts)
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 12);
  return {
    interactive: rank(interactiveCounts),
    headless:    rank(headlessCounts),
  };
}

/** Message node activity by hour-of-day, split into 3 time buckets */
function activityByHour(db) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 7 * 86400;
  const rows = db.prepare('SELECT created_at FROM message_nodes WHERE created_at > ?').all(cutoff);

  const b24  = new Array(24).fill(0);  // last 24 h, indexed by hour-of-day
  const b48  = new Array(24).fill(0);  // 24–48 h ago, indexed by hour-of-day

  // b7d: per-day rows for the past 7 days (days[0]=6 days ago ... days[6]=today)
  // Each entry is { date: 'YYYY-MM-DD', label: 'Mon', hours: [24 ints] }
  const todayStr = new Date().toISOString().slice(0, 10);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { weekday: 'short' });
    days.push({ date: dateStr, label, hours: new Array(24).fill(0) });
  }
  const dayMap = {};
  for (const d of days) dayMap[d.date] = d.hours;

  for (const r of rows) {
    const age = now - r.created_at;
    const h   = new Date(r.created_at * 1000).getHours();
    const dateStr = new Date(r.created_at * 1000).toISOString().slice(0, 10);
    if      (age < 86400)  b24[h]++;
    else if (age < 172800) b48[h]++;
    if (dayMap[dateStr]) dayMap[dateStr][h]++;
  }

  return { b24, b48, b7d: days };
}

/**
 * Single-pass token analysis over all assistant message_nodes.
 *
 * Each assistant message stores a `metadata.metrics` object with:
 *   input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
 * and a `metadata.generation_model` field — the *actual* model used for
 * that API call, which may differ from session.model if the config changed.
 *
 * Returns:
 *   byModel   — per-model aggregate (same shape as old modelTokenBreakdown)
 *   bySession — per-session token totals for leaderboard ranking
 */
function tokenBreakdown(db) {
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare(
    "SELECT session_id, created_at, chat_message FROM message_nodes WHERE chat_message LIKE '%generation_model%'"
  ).all();

  const byModel   = {};
  const bySession = {};

  // ── Time-window hourly buckets (token usage by hour-of-day) ──
  const WINDOWS = { '1d': 86400, '2d': 172800, '7d': 7 * 86400, '14d': 14 * 86400, '30d': 30 * 86400 };
  const byHour = {};
  for (const w of [...Object.keys(WINDOWS), 'all']) {
    byHour[w] = { input: new Array(24).fill(0), output: new Array(24).fill(0) };
  }

  // ── 30-day weekday×hour heatmap (Mon=0 .. Sun=6) ──
  const heatmap = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      windows: { '1d': 0, '7d': 0, '14d': 0, '30d': 0 },
    }))
  );

  for (const r of rows) {
    let msg;
    try { msg = JSON.parse(r.chat_message); } catch { continue; }
    if (msg?.role !== 'assistant') continue;

    const meta    = msg.metadata || {};
    const model   = meta.generation_model;
    const metrics = meta.metrics;
    if (!model || !metrics) continue;

    const input  = metrics.input_tokens          || 0;
    const output = metrics.output_tokens         || 0;
    const cRead  = metrics.cache_read_tokens     || 0;
    const cWrite = metrics.cache_creation_tokens || 0;

    // Per-model (existing behavior)
    if (!byModel[model]) {
      byModel[model] = { model, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    }
    const m = byModel[model];
    m.calls            += 1;
    m.inputTokens      += input;
    m.outputTokens     += output;
    m.cacheReadTokens  += cRead;
    m.cacheWriteTokens += cWrite;

    // Per-session (for leaderboards)
    const sid = r.session_id;
    if (!bySession[sid]) {
      bySession[sid] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
    }
    const s = bySession[sid];
    s.inputTokens      += input;
    s.outputTokens     += output;
    s.cacheReadTokens  += cRead;
    s.cacheWriteTokens += cWrite;
    s.totalTokens      += input + output + cRead + cWrite;

    // ── Per-hour bucketing (tokens by hour-of-day across time windows) ──
    const age = now - r.created_at;
    const dt  = new Date(r.created_at * 1000);
    const h   = dt.getHours();

    byHour['all'].input[h]  += input;
    byHour['all'].output[h] += output;
    for (const [w, cutoff] of Object.entries(WINDOWS)) {
      if (age <= cutoff) {
        byHour[w].input[h]  += input;
        byHour[w].output[h] += output;
      }
    }

    // ── Weekday×hour heatmap (30d, with per-window flyout data) ──
    if (age <= WINDOWS['30d']) {
      const dow = (dt.getDay() + 6) % 7; // JS 0=Sun → ISO 0=Mon
      const cell = heatmap[dow][h];
      cell.windows['30d'] += input;
      if (age <= WINDOWS['14d']) cell.windows['14d'] += input;
      if (age <= WINDOWS['7d'])  cell.windows['7d']  += input;
      if (age <= WINDOWS['1d'])  cell.windows['1d']  += input;
    }
  }

  return {
    byModel: Object.values(byModel).sort((a, b) => b.outputTokens - a.outputTokens),
    bySession,
    byHour,
    heatmap,
  };
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

/** Single most-recent prompt — cheap, safe to poll frequently */
function latestPrompt(db) {
  const row = db.prepare(
    'SELECT content, timestamp, is_shell FROM prompt_history ORDER BY timestamp DESC LIMIT 1'
  ).get();
  if (!row) return null;
  return { content: row.content, timestamp: row.timestamp, isShell: !!row.is_shell };
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
    'SELECT id, working_directory, model, created_at, last_activity_at, title FROM sessions'
  ).all();

  // Unified token scan — per-model, per-session, per-hour, and weekday heatmap
  const { byModel, bySession: tokensBySession, byHour: tokensByHour, heatmap: tokenHeatmap } = tokenBreakdown(db);

  // Per-session user message counts (for leaderboard)
  const userMsgRows = db.prepare(
    "SELECT session_id, COUNT(*) as c FROM message_nodes WHERE chat_message LIKE '%\"role\":\"user\"%' GROUP BY session_id"
  ).all();
  const userMsgBySession = {};
  for (const r of userMsgRows) userMsgBySession[r.session_id] = r.c;

  // Build session lookup for leaderboard enrichment
  const sessionMap = {};
  for (const s of sessions) {
    sessionMap[s.id] = {
      id: s.id,
      title: s.title || s.id.slice(0, 8),
      project: s.working_directory ? path.basename(s.working_directory) : 'unknown',
      durationSec: Math.max(0, (s.last_activity_at || 0) - (s.created_at || 0)),
    };
  }

  // Leaderboard: top 10 sessions by duration
  const topSessionsByDuration = Object.values(sessionMap)
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, 10)
    .map(s => ({
      id: s.id, title: s.title, project: s.project,
      durationSec: s.durationSec, durationStr: formatDuration(s.durationSec),
    }));

  // Leaderboard: top 10 sessions by user message count
  const topSessionsByUserMsgs = Object.entries(userMsgBySession)
    .filter(([sid]) => sessionMap[sid])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([sid, count]) => ({
      id: sid, title: sessionMap[sid].title, project: sessionMap[sid].project,
      userMsgCount: count,
    }));

  // Leaderboard: top 10 sessions by total token usage
  const topSessionsByTokens = Object.entries(tokensBySession)
    .filter(([sid]) => sessionMap[sid])
    .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
    .slice(0, 10)
    .map(([sid, tok]) => ({
      id: sid, title: sessionMap[sid].title, project: sessionMap[sid].project,
      ...tok,
    }));

  return {
    activity:    sessionActivityBuckets(sessions),
    sessionsByDay: sessionsByDay(sessions),
    projects:    projectBreakdown(db, sessions),
    tools:       topTools(db, sessions),
    activityByHour: activityByHour(db),
    tokensByHour,
    tokenHeatmap,
    models:      byModel,
    recentPrompts: recentPrompts(db),
    mcpServers:  mcpServers(config),
    skills:      installedSkills(),
    plugins:     installedPlugins(config),
    devinVersion: process.env.DEVIN_VERSION || null,
    model:       config?.agent?.model || null,
    permissionMode: config?.permissions ? 'configured' : 'default',
    // Leaderboards
    topSessionsByDuration,
    topSessionsByUserMsgs,
    topSessionsByTokens,
    // Subagents
    totalSubagents: countAllSubagents(),
  };
}

function getLatestPrompt() {
  const fdb = freshDb();
  try {
    return latestPrompt(fdb);
  } finally {
    fdb.close();
  }
}

module.exports = { getStats, getLatestPrompt, formatDuration };

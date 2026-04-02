/**
 * Sessions module — reads (and selectively writes) the Devin CLI SQLite database.
 *
 * Two connections to the Devin CLI sessions.db:
 *   readDb  — readonly, used for all queries (safe concurrent reads via WAL mode)
 *   writeDb — read-write, used only for session renames (UPDATE sessions SET title)
 *
 * This means renames are visible everywhere the Devin CLI reads — `devin list`,
 * `/ls` inside a session, and this dashboard all show the same title.
 *
 * Archive state (hidden sessions) is stored in a separate dashboard.db SQLite
 * database alongside sessions.db. Using SQLite instead of a JSON sidecar gives
 * safe concurrent writes from multiple browser tabs (no read-modify-write races).
 * An in-memory Set cache eliminates redundant disk reads on the 3s poll loop.
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { resolveDbPath, resolveDashboardDbPath } = require('./db-path');
const { formatDuration } = require('./stats');
const { sessionsWithSubagents, countSubagents } = require('./subagents');

// ── Devin CLI sessions.db ──────────────────────────────────────────────────────

let readDb;
let writeDb;

/**
 * Returns a readonly connection to sessions.db.
 *
 * Closes and reopens the connection on every call (~1ms) so queries always
 * read the latest WAL state.  A long-lived cached connection holds a stale
 * read snapshot in WAL mode, which means writes from the Devin CLI process
 * are invisible until the connection is recycled.  listSessionIds() and
 * findNewSessionInDir() already used fresh connections for this reason —
 * now all read paths behave the same way.
 */
function getReadDb() {
  if (readDb) {
    try { readDb.close(); } catch { /* already closed */ }
    readDb = null;
  }
  readDb = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  return readDb;
}

function getWriteDb() {
  if (!writeDb) {
    // WAL mode + busy_timeout already set by the CLI process; we inherit them.
    // Opening without readonly gives us write access on the same WAL file safely.
    writeDb = new Database(resolveDbPath(), { fileMustExist: true });
    writeDb.pragma('busy_timeout = 5000');
  }
  return writeDb;
}

// ── Dashboard metadata DB (hidden_sessions) ───────────────────────────────────

// Legacy JSON sidecar path — read once during migration, then renamed.
const LEGACY_HIDDEN_FILE = path.join(os.homedir(), '.config', 'devin', 'hidden-sessions.json');

let _dashDb = null;

/** Returns (lazily initialised) the dashboard.db connection, creating schema + migrating if needed. */
function getDashDb() {
  if (_dashDb) return _dashDb;

  const dbPath = resolveDashboardDbPath();
  _dashDb = new Database(dbPath);
  _dashDb.pragma('journal_mode = WAL');
  _dashDb.pragma('busy_timeout = 5000');
  _dashDb.exec(`
    CREATE TABLE IF NOT EXISTS hidden_sessions (
      session_id TEXT PRIMARY KEY
    )
  `);

  // One-time migration from legacy hidden-sessions.json sidecar
  _migrateLegacyHidden(_dashDb);

  return _dashDb;
}

/** Migrates archive state from the JSON sidecar to dashboard.db (runs once). */
function _migrateLegacyHidden(db) {
  if (!fs.existsSync(LEGACY_HIDDEN_FILE)) return;
  try {
    const ids = JSON.parse(fs.readFileSync(LEGACY_HIDDEN_FILE, 'utf8'));
    if (!Array.isArray(ids) || ids.length === 0) {
      fs.renameSync(LEGACY_HIDDEN_FILE, LEGACY_HIDDEN_FILE + '.migrated');
      return;
    }
    const insert = db.prepare('INSERT OR IGNORE INTO hidden_sessions (session_id) VALUES (?)');
    db.transaction(list => { for (const id of list) insert.run(id); })(ids);
    fs.renameSync(LEGACY_HIDDEN_FILE, LEGACY_HIDDEN_FILE + '.migrated');
    console.log(`[dashboard] Migrated ${ids.length} archived session(s) from JSON sidecar to dashboard.db`);
  } catch (err) {
    console.error('[dashboard] Migration warning (non-fatal):', err.message);
  }
}

// In-memory cache — eliminates disk reads on the 3s poll loop
let _hiddenCache = null;

/** Returns the Set of hidden session IDs, using the in-memory cache when available. */
function loadHidden() {
  if (_hiddenCache) return _hiddenCache;
  const rows = getDashDb().prepare('SELECT session_id FROM hidden_sessions').all();
  _hiddenCache = new Set(rows.map(r => r.session_id));
  return _hiddenCache;
}

/** Adds a session ID to the hidden set in both SQLite and the in-memory cache. */
function _addHidden(id) {
  getDashDb().prepare('INSERT OR IGNORE INTO hidden_sessions (session_id) VALUES (?)').run(id);
  if (_hiddenCache) _hiddenCache.add(id);
}

/** Removes a session ID from the hidden set in both SQLite and the in-memory cache. */
function _removeHidden(id) {
  getDashDb().prepare('DELETE FROM hidden_sessions WHERE session_id = ?').run(id);
  if (_hiddenCache) _hiddenCache.delete(id);
}

/**
 * Derives agent status from the last few message_nodes for a session.
 *
 * Four states (returned to client; "unread" is computed client-side):
 *   active    — Devin is currently doing something (tool calls in flight, or
 *               a tool result arrived recently meaning next turn is imminent)
 *   question  — Devin's last message is text with no tool calls AND it ends
 *               with a question — Devin is blocked waiting for an answer
 *   finished  — Devin's last message is text with no tool calls, no question,
 *               and nothing has happened for >30s — work is done / paused
 *   idle      — no activity for >10 minutes, or no messages at all
 */
function deriveStatus(nodes, lastActivityAt) {
  if (!nodes || nodes.length === 0) return 'idle';

  const nowSec = Math.floor(Date.now() / 1000);
  const idleSec = nowSec - lastActivityAt;

  // Hard idle cutoff: 10 minutes of silence = nothing is happening
  if (idleSec > 600) return 'idle';

  const last = nodes[nodes.length - 1];
  let msg;
  try {
    msg = typeof last.chat_message === 'string'
      ? JSON.parse(last.chat_message)
      : last.chat_message;
  } catch {
    return 'idle';
  }

  const role = msg?.role;
  const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;

  // Tool result or tool calls in last message = Devin is mid-turn
  // Also treat very recent activity (< 60s) on any role as active —
  // the next assistant turn is about to arrive
  if (role === 'tool' || hasToolCalls) return 'active';
  if (idleSec < 60) return 'active';

  // Past 60s of quiet — look at the last assistant text to decide
  if (role === 'assistant') {
    const rawContent = msg?.content;
    const text = Array.isArray(rawContent)
      ? rawContent.find(c => c.type === 'text')?.text
      : typeof rawContent === 'string' ? rawContent : null;

    if (!text || text.trim().length < 5) return 'idle';

    // Question detection: text ends with '?' (ignoring trailing whitespace/punctuation)
    const trimmed = text.trimEnd()
    const isQuestion = trimmed.endsWith('?')

    return isQuestion ? 'question' : 'finished';
  }

  // User or system message is last and it's been >60s — unusual, treat as finished
  return 'finished';
}

/**
 * Gets a short last-message snippet for sidebar display.
 */
function extractSnippet(nodes) {
  if (!nodes || nodes.length === 0) return null;

  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    let msg;
    try {
      msg = typeof node.chat_message === 'string'
        ? JSON.parse(node.chat_message)
        : node.chat_message;
    } catch {
      continue;
    }

    if (msg?.role === 'assistant') {
      const content = Array.isArray(msg.content)
        ? msg.content.find(c => c.type === 'text')?.text
        : typeof msg.content === 'string' ? msg.content : null;

      if (content) return content.slice(0, 120).replace(/\n/g, ' ');

      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        return `Using: ${msg.tool_calls[0].function?.name || 'tool'}`;
      }
    }
  }
  return null;
}

function relativeTime(epochSec) {
  const diffSec = Math.floor(Date.now() / 1000) - epochSec;
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Finds the first user-role message in a session — the original task prompt.
 * Queries the earliest nodes from the session rather than the tail used for
 * status/snippet, since we want the opening prompt not a follow-up.
 */
function extractFirstUserPrompt(db, sessionId) {
  const rows = db.prepare(`
    SELECT chat_message FROM message_nodes
    WHERE session_id = ?
    ORDER BY row_id ASC
    LIMIT 20
  `).all(sessionId);

  for (const row of rows) {
    let msg;
    try {
      msg = typeof row.chat_message === 'string'
        ? JSON.parse(row.chat_message)
        : row.chat_message;
    } catch { continue; }

    if (msg?.role !== 'user') continue;

    const rawContent = msg.content;
    const text = Array.isArray(rawContent)
      ? rawContent.find(c => c.type === 'text')?.text
      : typeof rawContent === 'string' ? rawContent : null;

    if (text && text.trim().length > 2) {
      return text.trim();
    }
  }
  return null;
}

/**
 * Finds the most recent user-role message in a session — the last thing
 * the user sent before Devin's current response.
 * Scans from the tail (DESC) so it finds the newest user turn first.
 */
function extractLastUserPrompt(db, sessionId) {
  const rows = db.prepare(`
    SELECT chat_message FROM message_nodes
    WHERE session_id = ?
    ORDER BY row_id DESC
    LIMIT 30
  `).all(sessionId);

  for (const row of rows) {
    let msg;
    try {
      msg = typeof row.chat_message === 'string'
        ? JSON.parse(row.chat_message)
        : row.chat_message;
    } catch { continue; }

    if (msg?.role !== 'user') continue;

    const rawContent = msg.content;
    const text = Array.isArray(rawContent)
      ? rawContent.find(c => c.type === 'text')?.text
      : typeof rawContent === 'string' ? rawContent : null;

    if (text && text.trim().length > 2) {
      return text.trim();
    }
  }
  return null;
}

function projectName(workingDir) {
  if (!workingDir) return 'unknown';
  return path.basename(workingDir);
}

/**
 * Returns all sessions enriched with status and last-message info.
 * Hidden (archived) sessions are excluded.
 * Title comes directly from sessions.title — the single source of truth.
 */
function listSessions() {
  const db = getReadDb();
  const hidden = loadHidden();
  const subagentSessions = sessionsWithSubagents();

  const sessions = db.prepare(`
    SELECT id, working_directory, model, created_at, last_activity_at, title
    FROM sessions
    ORDER BY last_activity_at DESC
  `).all();

  return sessions
    .filter(session => !hidden.has(session.id))
    .map(session => {
      const nodes = db.prepare(`
        SELECT chat_message FROM message_nodes
        WHERE session_id = ?
        ORDER BY row_id DESC LIMIT 5
      `).all(session.id).reverse();

      const status = deriveStatus(nodes, session.last_activity_at);
      const snippet = extractSnippet(nodes);
      const firstUserPrompt = extractFirstUserPrompt(db, session.id);
      const lastUserPrompt  = extractLastUserPrompt(db, session.id);

      return {
        id: session.id,
        title: session.title || session.id.slice(0, 8),
        workingDir: session.working_directory,
        project: projectName(session.working_directory),
        model: session.model,
        status,
        snippet,
        firstUserPrompt,
        lastUserPrompt,
        hasSubagents: subagentSessions.has(session.id),
        lastActivityAt: session.last_activity_at,
        lastActivityAgo: relativeTime(session.last_activity_at),
        createdAt: session.created_at,
      };
    });
}

function getSession(id) {
  const hidden = loadHidden();
  if (hidden.has(id)) return null;

  const db = getReadDb();

  const session = db.prepare(`
    SELECT id, working_directory, model, created_at, last_activity_at, title
    FROM sessions
    WHERE id = ?
  `).get(id);

  if (!session) return null;

  const nodes = db.prepare(`
    SELECT chat_message FROM message_nodes
    WHERE session_id = ?
    ORDER BY row_id DESC LIMIT 5
  `).all(session.id).reverse();

  const status = deriveStatus(nodes, session.last_activity_at);
  const snippet = extractSnippet(nodes);
  const firstUserPrompt = extractFirstUserPrompt(db, session.id);
  const lastUserPrompt  = extractLastUserPrompt(db, session.id);

  return {
    id: session.id,
    title: session.title || session.id.slice(0, 8),
    workingDir: session.working_directory,
    project: projectName(session.working_directory),
    model: session.model,
    status,
    snippet,
    firstUserPrompt,
    lastUserPrompt,
    lastActivityAt: session.last_activity_at,
    lastActivityAgo: relativeTime(session.last_activity_at),
    createdAt: session.created_at,
  };
}

/**
 * Renames a session by writing directly to sessions.title in the SQLite DB.
 * Uses the write connection (WAL mode handles concurrent CLI access safely).
 * The new title will be visible in `devin list`, /ls inside a session, and
 * this dashboard — single source of truth, no JSON sidecar needed.
 */
function renameSession(id, title) {
  const db = getWriteDb();
  const trimmed = (title || '').trim();
  if (!trimmed) return { id, title: null };
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(trimmed, id);
  return { id, title: trimmed };
}

/**
 * Archives a session by adding it to dashboard.db's hidden_sessions table.
 * The session record in the Devin CLI SQLite DB is untouched.
 * "Archive" is the user-facing term; "hidden" is the internal mechanism.
 */
function hideSession(id) {
  _addHidden(id);
  return { id, archived: true };
}

/**
 * Restores a previously archived session by removing it from dashboard.db.
 */
function restoreSession(id) {
  _removeHidden(id);
  return { id, archived: false };
}

/**
 * Returns all archived (hidden) sessions, enriched with status/snippet/etc.
 * Mirrors listSessions() but reads from the hidden set instead of excluding it.
 */
function listArchivedSessions() {
  const db = getReadDb();
  const hidden = loadHidden();

  if (hidden.size === 0) return [];

  const placeholders = [...hidden].map(() => '?').join(',');
  const sessions = db.prepare(`
    SELECT id, working_directory, model, created_at, last_activity_at, title
    FROM sessions
    WHERE id IN (${placeholders})
    ORDER BY last_activity_at DESC
  `).all(...hidden);

  return sessions.map(session => {
    const firstUserPrompt = extractFirstUserPrompt(db, session.id);
    return {
      id: session.id,
      title: session.title || session.id.slice(0, 8),
      workingDir: session.working_directory,
      project: projectName(session.working_directory),
      model: session.model,
      status: 'archived',
      snippet: null,
      firstUserPrompt,
      lastActivityAt: session.last_activity_at,
      lastActivityAgo: relativeTime(session.last_activity_at),
      createdAt: session.created_at,
    };
  });
}

/**
 * Returns rich preview data for a single session — stats + last N chat turns.
 * No PTY is spawned; this is pure DB reads, completely safe to call without
 * affecting last_activity_at.
 */
function getSessionPreview(id) {
  const db = getReadDb();

  const session = db.prepare(
    'SELECT id, working_directory, model, created_at, last_activity_at, title, agent_mode, backend_type, cogs_json FROM sessions WHERE id = ?'
  ).get(id);
  if (!session) return null;

  // ── Model: starting model (from sessions.model) vs current model (from cogs) ──
  const startingModel = session.model;
  let currentModel = startingModel;
  try {
    const cogs = JSON.parse(session.cogs_json || '[]');
    const modelCog = cogs.find(c => c.lifetime && c.lifetime.Unique === 'core/model');
    if (modelCog && modelCog.model) currentModel = modelCog.model;
  } catch { /* ignore */ }

  // ── Model switch history from prompt_history ──────────────────────────────
  const switchRows = db.prepare(
    "SELECT content, timestamp FROM prompt_history WHERE session_id = ? AND content LIKE '/model%' ORDER BY timestamp ASC"
  ).all(id);
  const modelSwitches = switchRows.map(r => ({
    model: r.content.replace('/model', '').trim(),
    timestamp: r.timestamp,
  }));

  // ── Single pass over all message_nodes for this session ──────────────────
  const allNodes = db.prepare(
    'SELECT chat_message, metadata, created_at FROM message_nodes WHERE session_id = ? ORDER BY row_id ASC'
  ).all(id);

  let userMsgCount = 0;
  let assistantMsgCount = 0;
  let toolCallCount = 0;
  let compactionCount = 0;
  let peakContextTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const toolCounts = {};
  const userPrompts = [];   // { text, createdAt }
  const chatThread = [];    // last N turns for preview rendering

  for (const node of allNodes) {
    // Metadata: compactions and token watermark
    if (node.metadata) {
      try {
        const meta = JSON.parse(node.metadata);
        if (meta.summarized_from !== null && meta.summarized_from !== undefined) {
          compactionCount++;
        }
        if (meta.num_tokens_preceding && meta.num_tokens_preceding > peakContextTokens) {
          peakContextTokens = meta.num_tokens_preceding;
        }
      } catch { /* skip */ }
    }

    // chat_message: roles, tool calls, user prompts
    let msg;
    try { msg = JSON.parse(node.chat_message); } catch { continue; }

    const role = msg?.role;

    if (role === 'user') {
      userMsgCount++;
      const rawContent = msg.content;
      const text = Array.isArray(rawContent)
        ? rawContent.find(c => c.type === 'text')?.text
        : typeof rawContent === 'string' ? rawContent : null;
      if (text && text.trim().length > 2) {
        const prompt = text.trim();
        userPrompts.push({ text: prompt, createdAt: node.created_at });
      }
    }

    if (role === 'assistant') {
      assistantMsgCount++;
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const name = tc?.name || tc?.function?.name;
          if (name) { toolCounts[name] = (toolCounts[name] || 0) + 1; toolCallCount++; }
        }
      }
      // Token metrics from API call metadata
      const meta = msg.metadata;
      if (meta?.metrics) {
        inputTokens      += meta.metrics.input_tokens          || 0;
        outputTokens     += meta.metrics.output_tokens         || 0;
        cacheReadTokens  += meta.metrics.cache_read_tokens     || 0;
        cacheWriteTokens += meta.metrics.cache_creation_tokens || 0;
      }
    }
  }

  // ── Build chat thread: last 5 user turns + the assistant reply after each ──
  // Walk backwards to find last 5 user prompts, capture the assistant response
  // that follows each one.
  const threadNodes = allNodes.slice(); // already ASC
  const threadTurns = [];

  let i = threadNodes.length - 1;
  while (i >= 0 && threadTurns.length < 5) {
    const node = threadNodes[i];
    let msg;
    try { msg = JSON.parse(node.chat_message); } catch { i--; continue; }

    if (msg?.role !== 'user') { i--; continue; }

    const rawContent = msg.content;
    const userText = Array.isArray(rawContent)
      ? rawContent.find(c => c.type === 'text')?.text
      : typeof rawContent === 'string' ? rawContent : null;

    if (!userText || userText.trim().length < 3) { i--; continue; }

    // Find the next assistant text response after this user message
    let assistantText = null;
    let assistantCreatedAt = null;
    for (let j = i + 1; j < Math.min(i + 40, threadNodes.length); j++) {
      let am;
      try { am = JSON.parse(threadNodes[j].chat_message); } catch { continue; }
      if (am?.role !== 'assistant') continue;
      const rawAss = am.content;
      const text = Array.isArray(rawAss)
        ? rawAss.find(c => c.type === 'text')?.text
        : typeof rawAss === 'string' ? rawAss : null;
      if (text && text.trim().length > 10) {
        assistantText = text.trim();
        assistantCreatedAt = threadNodes[j].created_at;
        break;
      }
    }

    threadTurns.unshift({
      userText: userText.trim(),
      assistantText,
      createdAt: node.created_at,
      assistantCreatedAt,
    });
    i--;
  }

  // ── Top tools ─────────────────────────────────────────────────────────────
  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  // ── Duration ──────────────────────────────────────────────────────────────
  const durationSec = Math.max(0, (session.last_activity_at || 0) - (session.created_at || 0));
  const durationStr = formatDuration(durationSec);

  // ── Project total duration (sum across all sessions in same working dir) ──
  const projectSessions = db.prepare(
    'SELECT created_at, last_activity_at FROM sessions WHERE working_directory = ?'
  ).all(session.working_directory);
  const projectDurationSec = projectSessions.reduce(
    (sum, s) => sum + Math.max(0, (s.last_activity_at || 0) - (s.created_at || 0)), 0
  );
  const projectDurationStr = formatDuration(projectDurationSec);

  return {
    id: session.id,
    title: session.title || session.id.slice(0, 8),
    workingDir: session.working_directory,
    project: projectName(session.working_directory),
    model: session.model,
    startingModel,
    currentModel,
    modelSwitches,
    permissionMode: session.agent_mode,
    backendType: session.backend_type,
    status: deriveStatus(
      allNodes.slice(-5).map(n => ({ chat_message: n.chat_message })),
      session.last_activity_at
    ),
    createdAt: session.created_at,
    createdAtStr: new Date(session.created_at * 1000).toLocaleString(),
    lastActivityAt: session.last_activity_at,
    lastActivityAgo: relativeTime(session.last_activity_at),
    durationStr,
    projectDurationStr,
    // Conversation stats
    totalNodes: allNodes.length,
    userMsgCount,
    assistantMsgCount,
    toolCallCount,
    compactionCount,
    peakContextTokens,
    topTools,
    // Subagent count — deduplicated via countSubagents()
    subagentCount: countSubagents(id),
    // Token usage
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    // Last 5 user→assistant exchanges for the chat preview
    chatThread: threadTurns,
  };
}

/**
 * Returns paginated user↔assistant conversation turns for a session.
 *
 * Scans message_nodes in row_id order, extracts only user and assistant text
 * (no tool calls, no system messages), pairs them into turns, then returns
 * the requested slice.  This powers the "full conversation" viewer in the
 * SessionPreview panel.
 *
 * @param {string} id     - Session ID
 * @param {number} offset - Number of turns to skip (from the end; 0 = most recent)
 * @param {number} limit  - Max turns to return (0 = all)
 * @returns {{ turns: Array<{userText: string, assistantText: string|null, createdAt: number}>, totalTurns: number, hasMore: boolean }}
 */
function getSessionConversation(id, offset = 0, limit = 50) {
  const db = getReadDb();

  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
  if (!session) return null;

  // Pull only the columns we need — chat_message for text, created_at for timestamps
  const allNodes = db.prepare(
    'SELECT chat_message, created_at FROM message_nodes WHERE session_id = ? ORDER BY row_id ASC'
  ).all(id);

  // Build all user→assistant turns (same pairing logic as getSessionPreview)
  const allTurns = [];

  for (let i = 0; i < allNodes.length; i++) {
    let msg;
    try { msg = JSON.parse(allNodes[i].chat_message); } catch { continue; }

    if (msg?.role !== 'user') continue;

    const rawContent = msg.content;
    const userText = Array.isArray(rawContent)
      ? rawContent.find(c => c.type === 'text')?.text
      : typeof rawContent === 'string' ? rawContent : null;

    if (!userText || userText.trim().length < 3) continue;

    // Find the next assistant text response after this user message
    let assistantText = null;
    let assistantCreatedAt = null;
    for (let j = i + 1; j < Math.min(i + 40, allNodes.length); j++) {
      let am;
      try { am = JSON.parse(allNodes[j].chat_message); } catch { continue; }
      if (am?.role !== 'assistant') continue;
      const rawAss = am.content;
      const text = Array.isArray(rawAss)
        ? rawAss.find(c => c.type === 'text')?.text
        : typeof rawAss === 'string' ? rawAss : null;
      if (text && text.trim().length > 10) {
        assistantText = text.trim();
        assistantCreatedAt = allNodes[j].created_at;
        break;
      }
    }

    allTurns.push({
      userText: userText.trim(),
      assistantText,
      createdAt: allNodes[i].created_at,
      assistantCreatedAt,
    });
  }

  const totalTurns = allTurns.length;

  // offset counts from the end (most recent), so slice accordingly
  // offset=0, limit=50 → last 50 turns
  // offset=50, limit=100 → turns before those last 50
  let sliced;
  if (limit === 0) {
    // "Load all" — return everything
    sliced = allTurns;
  } else {
    const end = totalTurns - offset;
    const start = Math.max(0, end - limit);
    sliced = allTurns.slice(start, Math.max(end, 0));
  }

  return {
    turns: sliced,
    totalTurns,
    hasMore: limit === 0 ? false : (totalTurns - offset - sliced.length) > 0,
  };
}

/**
 * Searches sessions by title, working directory, prompt history, and user-role
 * message content. Returns the same shape as listSessions() so AgentCard renders
 * without any changes.
 *
 * Uses correlated EXISTS subqueries so a session matching in multiple rows of
 * prompt_history or message_nodes is deduplicated at the SQL level.
 *
 * @param {string}  query           - The search term (case-insensitive, substring)
 * @param {boolean} includeArchived - When true, archived sessions are included
 */
function searchSessions(query, includeArchived) {
  const db = getReadDb();
  const hidden = loadHidden();
  const term = `%${query}%`;

  const rows = db.prepare(`
    SELECT DISTINCT s.id, s.working_directory, s.model, s.created_at, s.last_activity_at, s.title
    FROM sessions s
    WHERE (
      s.title LIKE ? COLLATE NOCASE
      OR s.working_directory LIKE ? COLLATE NOCASE
      OR EXISTS (
        SELECT 1 FROM prompt_history ph
        WHERE ph.session_id = s.id AND ph.content LIKE ? COLLATE NOCASE
      )
      OR EXISTS (
        SELECT 1 FROM message_nodes mn
        WHERE mn.session_id = s.id
          AND mn.chat_message LIKE ? COLLATE NOCASE
          AND mn.chat_message LIKE '%"role":"user"%'
      )
    )
    ORDER BY s.last_activity_at DESC
  `).all(term, term, term, term);

  const filtered = includeArchived
    ? rows
    : rows.filter(s => !hidden.has(s.id));

  return filtered.map(session => {
    const nodes = db.prepare(`
      SELECT chat_message FROM message_nodes
      WHERE session_id = ?
      ORDER BY row_id DESC LIMIT 5
    `).all(session.id).reverse();

    const status = deriveStatus(nodes, session.last_activity_at);
    const snippet = extractSnippet(nodes);
    const firstUserPrompt = extractFirstUserPrompt(db, session.id);
    const lastUserPrompt  = extractLastUserPrompt(db, session.id);

    return {
      id: session.id,
      title: session.title || session.id.slice(0, 8),
      workingDir: session.working_directory,
      project: projectName(session.working_directory),
      model: session.model,
      status,
      snippet,
      firstUserPrompt,
      lastUserPrompt,
      lastActivityAt: session.last_activity_at,
      lastActivityAgo: relativeTime(session.last_activity_at),
      createdAt: session.created_at,
      hasSubagents: sessionsWithSubagents().has(session.id),
    };
  });
}

/**
 * Returns all unique working directories (repos) seen across all sessions —
 * including archived ones. Used by the "New Session" feature to let the user
 * pick from known repos.
 */
function listRepos() {
  const db = getReadDb();
  const rows = db.prepare(`
    SELECT DISTINCT working_directory
    FROM sessions
    WHERE working_directory IS NOT NULL AND working_directory != ''
    ORDER BY working_directory ASC
  `).all();

  return rows.map(r => ({
    workingDir: r.working_directory,
    project: projectName(r.working_directory),
  }));
}

/**
 * Returns a Set of all session IDs currently in the database.
 * Uses a fresh connection to see the very latest writes by the Devin CLI.
 */
function listSessionIds() {
  const freshDb = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  try {
    const rows = freshDb.prepare('SELECT id FROM sessions').all();
    return new Set(rows.map(r => r.id));
  } finally {
    freshDb.close();
  }
}

/**
 * Finds a session by working_directory whose ID is not in the given exclusion set.
 * Uses a fresh connection to detect recently-created sessions.
 * Returns the session ID or null if not found.
 */
function findNewSessionInDir(workingDir, excludeIds) {
  const freshDb = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  try {
    const rows = freshDb.prepare(`
      SELECT id FROM sessions
      WHERE working_directory = ?
      ORDER BY created_at DESC
    `).all(workingDir);

    for (const row of rows) {
      if (!excludeIds.has(row.id)) return row.id;
    }
    return null;
  } finally {
    freshDb.close();
  }
}

/**
 * Returns context window breakdown for a session — estimated token counts
 * per category (system prompt, user messages, assistant messages, tool calls,
 * tool results) plus free capacity.
 *
 * Strategy: count characters in each message category within the active context
 * (after the last compaction), compute proportions, then scale to fit the
 * actual total from num_tokens_preceding on the latest message node.
 *
 * @param {string} id  - Session ID
 * @returns {object|null} - { categories, totalUsed, maxContext, freeTokens, compactionCount }
 */
function getSessionContextBreakdown(id) {
  const db = getReadDb();

  const session = db.prepare(
    'SELECT id, model, cogs_json FROM sessions WHERE id = ?'
  ).get(id);
  if (!session) return null;

  // Model context limits (tokens)
  const MODEL_LIMITS = {
    'claude-sonnet-4-6':          200000,
    'claude-sonnet-4-6-thinking': 200000,
    'claude-opus-4-6':            200000,
    'claude-opus-4-6-thinking':   200000,
    'MODEL_PRIVATE_2':            200000,
    'MODEL_SWE_1_5_SLOW':        200000,
    'MODEL_CLAUDE_4_SONNET':      200000,
  };

  // Resolve current model from cogs (may differ from session.model)
  let currentModel = session.model;
  try {
    const cogs = JSON.parse(session.cogs_json || '[]');
    const modelCog = cogs.find(c => c.lifetime && c.lifetime.Unique === 'core/model');
    if (modelCog && modelCog.model) currentModel = modelCog.model;
  } catch { /* ignore */ }

  const maxContext = MODEL_LIMITS[currentModel] || 200000;

  const allNodes = db.prepare(
    'SELECT node_id, chat_message, metadata FROM message_nodes WHERE session_id = ? ORDER BY row_id ASC'
  ).all(id);

  // Find last compaction boundary and actual token count
  let lastCompactionNode = 0;
  let compactionCount = 0;
  let actualTotal = 0;

  for (const n of allNodes) {
    let meta;
    try { meta = JSON.parse(n.metadata); } catch { continue; }
    if (meta && meta.summarized_from !== null && meta.summarized_from !== undefined) {
      compactionCount++;
      lastCompactionNode = n.node_id;
    }
    if (meta && meta.num_tokens_preceding !== null && meta.num_tokens_preceding !== undefined) {
      actualTotal = meta.num_tokens_preceding; // keep updating to get latest
    }
  }

  // Count characters per category in active context (system msgs always + post-compaction)
  const charCounts = {
    systemPrompt: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
  };

  for (const n of allNodes) {
    let msg;
    try { msg = JSON.parse(n.chat_message); } catch { continue; }

    // System messages are always in context; other roles only if after last compaction
    if (msg.role !== 'system' && n.node_id < lastCompactionNode) continue;

    const contentLen = typeof msg.content === 'string' ? msg.content.length :
      (Array.isArray(msg.content) ? JSON.stringify(msg.content).length : 0);

    if (msg.role === 'system') charCounts.systemPrompt += contentLen;
    else if (msg.role === 'user') charCounts.userMessages += contentLen;
    else if (msg.role === 'assistant') {
      charCounts.assistantMessages += contentLen;
      if (msg.tool_calls) charCounts.toolCalls += JSON.stringify(msg.tool_calls).length;
    }
    else if (msg.role === 'tool') charCounts.toolResults += contentLen;
  }

  // Estimate proportional token counts and scale to actual
  const totalChars = Object.values(charCounts).reduce((a, b) => a + b, 0);
  const categories = {};
  if (totalChars > 0 && actualTotal > 0) {
    for (const [key, chars] of Object.entries(charCounts)) {
      const proportion = chars / totalChars;
      categories[key] = Math.round(proportion * actualTotal);
    }
  } else {
    // Fallback: rough ÷4 estimate
    for (const [key, chars] of Object.entries(charCounts)) {
      categories[key] = Math.round(chars / 4);
    }
    if (actualTotal === 0) {
      actualTotal = Object.values(categories).reduce((a, b) => a + b, 0);
    }
  }

  const freeTokens = Math.max(0, maxContext - actualTotal);

  return {
    categories,
    totalUsed: actualTotal,
    maxContext,
    freeTokens,
    compactionCount,
    model: currentModel,
  };
}

/**
 * Extracts per-session configuration from cogs_json — active rules, skills,
 * permissions, and other session-scoped settings.
 *
 * @param {string} id - Session ID
 * @returns {object|null} - { rules, skills, permissions, activeSkills, model, permissionMode }
 */
function getSessionConfig(id) {
  const db = getReadDb();

  const session = db.prepare(
    'SELECT id, cogs_json, agent_mode, model FROM sessions WHERE id = ?'
  ).get(id);
  if (!session) return null;

  let cogs;
  try { cogs = JSON.parse(session.cogs_json || '[]'); } catch { cogs = []; }

  // Extract active skills (cogs with lifetime Unique matching "skill/*")
  const activeSkills = [];
  const rules = [];
  const permissions = [];
  let model = session.model;
  let permissionMode = session.agent_mode;

  for (const cog of cogs) {
    const lifetime = cog.lifetime?.Unique || '';

    // Skills: lifetime like "skill/research-visualizer"
    if (lifetime.startsWith('skill/')) {
      activeSkills.push({
        name: lifetime.replace('skill/', ''),
        source: typeof cog.source === 'object' && cog.source.Session ? cog.source.Session : String(cog.source),
      });
    }

    // Model: core/model cog
    if (lifetime === 'core/model' && cog.model) {
      model = cog.model;
    }

    // Extract permission entries
    if (cog.permissions && Array.isArray(cog.permissions)) {
      for (const perm of cog.permissions) {
        if (!Array.isArray(perm) || perm.length < 2) continue;
        const scope = perm[0];
        const action = perm[1]; // "Allow", "ForceAsk", etc.
        let desc = '';
        if (typeof scope === 'string') desc = scope;
        else if (scope.Scope) {
          const s = scope.Scope;
          if (s.Read) desc = `Read: ${typeof s.Read === 'object' ? s.Read.glob : s.Read}`;
          else if (s.Write) desc = `Write: ${typeof s.Write === 'object' ? s.Write.glob : s.Write}`;
          else if (s.Command) desc = `Command: ${s.Command.matcher?.Prefix || JSON.stringify(s.Command)}`;
          else desc = JSON.stringify(s);
        }
        else if (scope.Tool) {
          const t = scope.Tool;
          desc = `Tool: ${t.Name?.exact || JSON.stringify(t)}`;
        }
        else if (scope === 'AnyScope') desc = 'AnyScope';
        else desc = JSON.stringify(scope);

        if (desc) permissions.push({ scope: desc, action });
      }
    }
  }

  // Extract rules from the first few system messages in the session
  const systemNodes = db.prepare(
    "SELECT chat_message FROM message_nodes WHERE session_id = ? ORDER BY row_id ASC LIMIT 10"
  ).all(id);

  for (const n of systemNodes) {
    let msg;
    try { msg = JSON.parse(n.chat_message); } catch { continue; }
    if (msg?.role !== 'system') continue;
    const content = typeof msg.content === 'string' ? msg.content : '';

    // Extract rule names from <rule name="..."> tags
    const ruleMatches = content.matchAll(/<rule\s+name="([^"]+)">/g);
    for (const m of ruleMatches) {
      if (!rules.includes(m[1])) rules.push(m[1]);
    }
  }

  return {
    rules,
    activeSkills,
    permissions: permissions.slice(0, 20), // Cap to avoid huge payloads
    model,
    permissionMode,
  };
}

module.exports = { listSessions, listArchivedSessions, getSession, getSessionPreview, getSessionConversation, getSessionContextBreakdown, getSessionConfig, renameSession, hideSession, restoreSession, listRepos, listSessionIds, findNewSessionInDir, searchSessions };

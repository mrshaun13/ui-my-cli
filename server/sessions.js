/**
 * Sessions module — reads Devin CLI SQLite database.
 *
 * Opens the DB in read-only mode so we never corrupt live session data.
 * Status detection mirrors the Devin CLI's own logic derived from message_nodes.
 *
 * Hidden sessions: stored in hidden-sessions.json sidecar. Sessions listed
 * there are excluded from all API responses — this is how "rm-session" works
 * since the DB is read-only.
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { resolveDbPath } = require('./db-path');

const ALIAS_FILE  = path.join(os.homedir(), '.config', 'devin', 'session-aliases.json');
const HIDDEN_FILE = path.join(os.homedir(), '.config', 'devin', 'hidden-sessions.json');

let db;

function getDb() {
  if (!db) {
    const dbPath = resolveDbPath();
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  }
  return db;
}

function loadAliases() {
  try {
    if (fs.existsSync(ALIAS_FILE)) return JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8'));
  } catch { /* malformed — ignore */ }
  return {};
}

function loadHidden() {
  try {
    if (fs.existsSync(HIDDEN_FILE)) return new Set(JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8')));
  } catch { /* malformed — ignore */ }
  return new Set();
}

function saveHidden(hiddenSet) {
  const dir = path.dirname(HIDDEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(HIDDEN_FILE, JSON.stringify([...hiddenSet], null, 2));
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
 * Returns all sessions enriched with status, alias, and last-message info.
 * Hidden sessions are excluded.
 */
function listSessions() {
  const db = getDb();
  const aliases = loadAliases();
  const hidden = loadHidden();

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
      const alias = aliases[session.id] || null;
      const firstUserPrompt = extractFirstUserPrompt(db, session.id);
      const lastUserPrompt  = extractLastUserPrompt(db, session.id);

      return {
        id: session.id,
        title: session.title || session.id.slice(0, 8),
        label: alias,
        alias,
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
    });
}

function getSession(id) {
  return listSessions().find(s => s.id === id) || null;
}

function renameSession(id, alias) {
  const aliases = loadAliases();
  if (alias && alias.trim()) {
    aliases[id] = alias.trim();
  } else {
    delete aliases[id];
  }
  const dir = path.dirname(ALIAS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ALIAS_FILE, JSON.stringify(aliases, null, 2));
  return { id, alias: aliases[id] || null };
}

/**
 * Archives a session by adding it to hidden-sessions.json.
 * The session record in the SQLite DB is untouched (DB is read-only).
 * "Archive" is the user-facing term; "hidden" is the internal mechanism.
 */
function hideSession(id) {
  const hidden = loadHidden();
  hidden.add(id);
  saveHidden(hidden);
  return { id, archived: true };
}

/**
 * Restores a previously archived session by removing it from hidden-sessions.json.
 */
function restoreSession(id) {
  const hidden = loadHidden();
  hidden.delete(id);
  saveHidden(hidden);
  return { id, archived: false };
}

/**
 * Returns all archived (hidden) sessions, enriched with status/snippet/etc.
 * Mirrors listSessions() but reads from the hidden set instead of excluding it.
 */
function listArchivedSessions() {
  const db = getDb();
  const aliases = loadAliases();
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
    const alias = aliases[session.id] || null;
    const firstUserPrompt = extractFirstUserPrompt(db, session.id);
    return {
      id: session.id,
      title: session.title || session.id.slice(0, 8),
      label: alias,
      alias,
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
  const db = getDb();
  const aliases = loadAliases();

  const session = db.prepare(
    'SELECT id, working_directory, model, created_at, last_activity_at, title, permission_mode, backend_type, cogs_json FROM sessions WHERE id = ?'
  ).get(id);
  if (!session) return null;

  const alias = aliases[id] || null;

  // ── Single pass over all message_nodes for this session ──────────────────
  const allNodes = db.prepare(
    'SELECT chat_message, metadata, created_at FROM message_nodes WHERE session_id = ? ORDER BY row_id ASC'
  ).all(id);

  let userMsgCount = 0;
  let assistantMsgCount = 0;
  let toolCallCount = 0;
  let compactionCount = 0;
  let peakContextTokens = 0;
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
    for (let j = i + 1; j < Math.min(i + 20, threadNodes.length); j++) {
      let am;
      try { am = JSON.parse(threadNodes[j].chat_message); } catch { continue; }
      if (am?.role !== 'assistant') continue;
      const rawAss = am.content;
      const text = Array.isArray(rawAss)
        ? rawAss.find(c => c.type === 'text')?.text
        : typeof rawAss === 'string' ? rawAss : null;
      if (text && text.trim().length > 10) {
        assistantText = text.trim();
        break;
      }
    }

    threadTurns.unshift({
      userText: userText.trim(),
      assistantText,
      createdAt: node.created_at,
    });
    i--;
  }

  // ── Top tools ─────────────────────────────────────────────────────────────
  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  // ── Duration ──────────────────────────────────────────────────────────────
  const durationSec = session.last_activity_at - session.created_at;
  const durationHours = Math.floor(durationSec / 3600);
  const durationMins  = Math.floor((durationSec % 3600) / 60);
  const durationStr   = durationHours > 0
    ? `${durationHours}h ${durationMins}m`
    : `${durationMins}m`;

  return {
    id: session.id,
    title: session.title || session.id.slice(0, 8),
    alias,
    workingDir: session.working_directory,
    project: projectName(session.working_directory),
    model: session.model,
    permissionMode: session.permission_mode,
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
    // Conversation stats
    totalNodes: allNodes.length,
    userMsgCount,
    assistantMsgCount,
    toolCallCount,
    compactionCount,
    peakContextTokens,
    topTools,
    // Last 5 user→assistant exchanges for the chat preview
    chatThread: threadTurns,
  };
}

module.exports = { listSessions, listArchivedSessions, getSession, getSessionPreview, renameSession, hideSession, restoreSession };

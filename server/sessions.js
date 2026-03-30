/**
 * Sessions module — reads Devin CLI SQLite database.
 *
 * Opens the DB in read-only mode so we never corrupt live session data.
 * Status detection mirrors the Devin CLI's own logic derived from message_nodes.
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { resolveDbPath } = require('./db-path');

const ALIAS_FILE  = path.join(os.homedir(), '.config', 'devin', 'session-aliases.json');
const STATUS_FILE = path.join(os.homedir(), '.config', 'devin', 'session-status.json');

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

/**
 * Loads manually-set session statuses from session-status.json.
 * These are set by the devin-sessions CLI tool (e.g. after /clear → "ready for work").
 * Keys are session IDs, values are freeform strings like "ready for work".
 */
function loadManualStatuses() {
  try {
    if (fs.existsSync(STATUS_FILE)) return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch { /* malformed — ignore */ }
  return {};
}

/**
 * Normalises a freeform manual status string into one of our display statuses.
 * Returns null if the string isn't recognisable as a ready/waiting state.
 */
function normaliseManualStatus(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (s.includes('ready') || s.includes('waiting') || s.includes('done')) return 'ready';
  return null;
}

/**
 * Derives agent status from the last few message_nodes for a session.
 *
 * Priority (highest first):
 *   ready      — manually marked ready via session-status.json (e.g. after /clear)
 *   needs_you  — assistant message with no tool_calls, idle 30s+
 *   running    — assistant message with active tool_calls
 *   thinking   — tool result or user message, activity < 30s
 *   idle       — no recent activity (> 5 minutes)
 */
function deriveStatus(nodes, lastActivityAt, manualStatus) {
  // Manual override wins — these are explicitly set by the user
  const manual = normaliseManualStatus(manualStatus);
  if (manual) return manual;

  if (!nodes || nodes.length === 0) return 'idle';

  const nowSec = Math.floor(Date.now() / 1000);
  const idleSec = nowSec - lastActivityAt;

  if (idleSec > 300) return 'idle';

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
  const isToolResult = role === 'tool';

  if (role === 'assistant' && !hasToolCalls && idleSec >= 30) {
    // Only return needs_you if the assistant message has actual readable text content.
    // Devin often leaves a final empty assistant message after completing work; that
    // should resolve to idle, not needs_you.
    const rawContent = msg?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.find(c => c.type === 'text')?.text
      : typeof rawContent === 'string' ? rawContent : null;
    const hasContent = content && content.trim().length > 10;
    if (!hasContent) return 'idle';
    return 'needs_you';
  }
  if (role === 'assistant' && hasToolCalls) return 'running';
  if (isToolResult || (role === 'user' && idleSec < 30)) return 'thinking';

  return idleSec < 30 ? 'thinking' : 'needs_you';
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

function projectName(workingDir) {
  if (!workingDir) return 'unknown';
  return path.basename(workingDir);
}

/**
 * Returns all sessions enriched with status, alias, and last-message info.
 */
function listSessions() {
  const db = getDb();
  const aliases = loadAliases();
  const manualStatuses = loadManualStatuses();

  const sessions = db.prepare(`
    SELECT id, working_directory, model, created_at, last_activity_at, title
    FROM sessions
    ORDER BY last_activity_at DESC
  `).all();

  return sessions.map(session => {
    const nodes = db.prepare(`
      SELECT chat_message FROM message_nodes
      WHERE session_id = ?
      ORDER BY row_id DESC LIMIT 5
    `).all(session.id).reverse();

    const manualStatus = manualStatuses[session.id] || aliases[session.id] || null;
    const status = deriveStatus(nodes, session.last_activity_at, manualStatus);
    const snippet = extractSnippet(nodes);
    const alias = aliases[session.id] || null;

    return {
      id: session.id,
      // title always comes from the DB so it stays stable across /clear continuations.
      // alias is the short user label (e.g. "ready for work"); shown separately as label.
      title: session.title || session.id.slice(0, 8),
      label: alias,
      alias,
      workingDir: session.working_directory,
      project: projectName(session.working_directory),
      model: session.model,
      status,
      manualStatus: normaliseManualStatus(manualStatus),
      snippet,
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

module.exports = { listSessions, getSession, renameSession };

/**
 * Subagent lifecycle extraction — mines run_subagent data from message_nodes.
 *
 * The Devin CLI stores the full subagent lifecycle in the conversation stream:
 *   1. Launch:      assistant role, tool_calls[].name === 'run_subagent'
 *   2. Confirmation: tool role result for that tool_call_id (contains agend_id)
 *   3. Completion:  system role, <subagent_completion_notification>
 *
 * This module does a single-pass scan of message_nodes for a session,
 * correlates the three events, deduplicates context-compaction duplicates,
 * and returns a structured array of subagent lifecycle records.
 *
 * Note: "agend_id" (missing 't') is a typo in the Devin CLI itself.
 */

const Database = require('better-sqlite3');
const { resolveDbPath } = require('./paths');

const CACHE_TTL_MS = 60_000;

let readDb;

/** Returns a read-only connection that always sees the latest WAL state.
 *  Closes and reopens on every call (~1ms) like sessions.js getReadDb(). */
function getReadDb() {
  if (readDb) {
    try { readDb.close(); } catch { /* already closed */ }
    readDb = null;
  }
  readDb = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  return readDb;
}

/**
 * Extracts the text content from a polymorphic message content field.
 * Content can be a bare string or an Array<{ type: 'text', text: string }>.
 */
function extractText(content) {
  if (Array.isArray(content)) {
    const textBlock = content.find(c => c.type === 'text');
    return textBlock?.text || null;
  }
  return typeof content === 'string' ? content : null;
}

/**
 * Extracts all subagent lifecycle records for a given session.
 *
 * @param {string} sessionId — The session UUID
 * @returns {Array<Object>} — Structured subagent records, sorted by launch order
 *
 * Each record:
 *   {
 *     id:            string,   // tool_call_id (unique per launch)
 *     title:         string,   // from run_subagent arguments
 *     profile:       string,   // 'subagent_explore' | 'subagent_general'
 *     isBackground:  boolean,
 *     agentId:       string|null,  // 8-char hex from confirmation (null for inline foreground)
 *     task:          string,   // full task text
 *     launchedAt:    number,   // epoch seconds
 *     completedAt:   number|null,
 *     durationSec:   number|null,
 *     resultPreview: string|null,  // first ~300 chars of completion/result text
 *   }
 */
function extractSubagents(sessionId) {
  const db = getReadDb();

  // Pre-filter with LIKE to avoid scanning every row in a session.
  // This matches assistant launch messages, tool confirmation messages,
  // and system completion notifications — all contain "subagent" or "run_subagent".
  const rows = db.prepare(`
    SELECT row_id, chat_message, created_at
    FROM message_nodes
    WHERE session_id = ?
      AND (chat_message LIKE '%run_subagent%' OR chat_message LIKE '%subagent_completion_notification%')
    ORDER BY row_id ASC
  `).all(sessionId);

  // Phase 1: Collect launches (deduplicated by tool_call_id)
  const launches = new Map();       // tool_call_id → launch record
  const agentIdMap = new Map();     // agentId → tool_call_id (for completion correlation)
  const seenToolCallIds = new Set();

  for (const row of rows) {
    let msg;
    try { msg = JSON.parse(row.chat_message); } catch { continue; }

    const role = msg?.role;

    // ── Launch: assistant message with run_subagent tool calls ──────────
    if (role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const name = tc?.name || tc?.function?.name;
        if (name !== 'run_subagent') continue;

        const toolCallId = tc.id;
        if (!toolCallId || seenToolCallIds.has(toolCallId)) continue;
        seenToolCallIds.add(toolCallId);

        let args = {};
        try {
          const rawArgs = tc.arguments || tc?.function?.arguments;
          args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {});
        } catch { /* skip */ }

        launches.set(toolCallId, {
          id: toolCallId,
          title: args.title || 'Untitled subagent',
          profile: args.profile || 'unknown',
          isBackground: args.is_background !== false, // default true
          agentId: null,
          task: args.task || '',
          launchedAt: row.created_at,
          completedAt: null,
          durationSec: null,
          resultPreview: null,
        });
      }
    }

    // ── Confirmation: tool role result with agend_id ───────────────────
    if (role === 'tool' && msg.tool_call_id) {
      const launch = launches.get(msg.tool_call_id);
      if (launch) {
        const content = typeof msg.content === 'string' ? msg.content : '';

        // Background subagent confirmation: "Background subagent started with agend_id=XXXXXXXX"
        const agentMatch = content.match(/agend_id=([a-f0-9]+)/i);
        if (agentMatch) {
          launch.agentId = agentMatch[1];
          agentIdMap.set(agentMatch[1], msg.tool_call_id);
        }

        // Foreground subagent that got auto-promoted to background:
        // "Subagent moved to background with ID: XXXXXXXX"
        const movedMatch = content.match(/moved to background with ID:\s*([a-f0-9]+)/i);
        if (movedMatch && !launch.agentId) {
          launch.agentId = movedMatch[1];
          agentIdMap.set(movedMatch[1], msg.tool_call_id);
        }

        // Inline foreground result (no agend_id, content IS the result)
        if (!agentMatch && !movedMatch && !content.includes('agend_id') && content.length > 20) {
          launch.resultPreview = content.slice(0, 300);
          // For inline results, the response time IS the completion time
          launch.completedAt = row.created_at;
          launch.durationSec = Math.max(0, row.created_at - launch.launchedAt);
        }
      }
    }

    // ── Completion: system role with <subagent_completion_notification> ─
    if (role === 'system') {
      const content = extractText(msg.content) || '';
      if (!content.includes('subagent_completion_notification')) continue;

      // Extract agent_id from "[Background subagent with agent_id=XXXXXXXX completed]"
      const idMatch = content.match(/agent_id=([a-f0-9]+)/i);
      if (!idMatch) continue;

      const agentId = idMatch[1];
      const toolCallId = agentIdMap.get(agentId);
      if (!toolCallId) continue;

      const launch = launches.get(toolCallId);
      if (!launch || launch.completedAt) continue; // already completed (dedup)

      launch.completedAt = row.created_at;
      launch.durationSec = Math.max(0, row.created_at - launch.launchedAt);

      // Extract result preview — everything after the "[...completed]" line
      const completedIdx = content.indexOf('completed]');
      if (completedIdx !== -1) {
        const resultText = content.slice(completedIdx + 'completed]'.length).trim();
        if (resultText.length > 0) {
          launch.resultPreview = resultText.slice(0, 300);
        }
      }
    }
  }

  // Phase 2: Fill in foreground subagent results that the main query missed.
  // Foreground tool-role responses may not contain "run_subagent" or
  // "subagent_completion_notification" in their content, so we query by
  // tool_call_id directly for any uncompleted foreground launches.
  const uncompleted = Array.from(launches.values()).filter(
    l => !l.completedAt && !l.isBackground && !l.agentId
  );
  for (const launch of uncompleted) {
    const fgRows = db.prepare(`
      SELECT chat_message, created_at
      FROM message_nodes
      WHERE session_id = ? AND chat_message LIKE ?
      ORDER BY row_id ASC
    `).all(sessionId, `%${launch.id}%`);

    for (const fgRow of fgRows) {
      let fgMsg;
      try { fgMsg = JSON.parse(fgRow.chat_message); } catch { continue; }
      if (fgMsg?.role !== 'tool' || fgMsg.tool_call_id !== launch.id) continue;
      const content = typeof fgMsg.content === 'string' ? fgMsg.content : '';
      if (content.length > 20) {
        launch.resultPreview = content.slice(0, 300);
        launch.completedAt = fgRow.created_at;
        launch.durationSec = Math.max(0, fgRow.created_at - launch.launchedAt);
      }
    }
  }

  // Return sorted by launch order (row_id ASC is already the insertion order)
  return Array.from(launches.values());
}

/**
 * Returns just the count of unique subagent launches for a session.
 * Cheaper than extractSubagents() — uses a targeted LIKE query with dedup.
 *
 * @param {string} sessionId
 * @returns {number}
 */
function countSubagents(sessionId) {
  const db = getReadDb();
  const rows = db.prepare(`
    SELECT chat_message
    FROM message_nodes
    WHERE session_id = ?
      AND chat_message LIKE '%"name":"run_subagent"%'
    ORDER BY row_id ASC
  `).all(sessionId);

  const seen = new Set();
  for (const row of rows) {
    let msg;
    try { msg = JSON.parse(row.chat_message); } catch { continue; }
    if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;
    for (const tc of msg.tool_calls) {
      const name = tc?.name || tc?.function?.name;
      if (name === 'run_subagent' && tc.id) seen.add(tc.id);
    }
  }
  return seen.size;
}

/**
 * Returns the total number of unique subagent launches across ALL sessions.
 * Used by the dashboard stats endpoint.
 *
 * @returns {number}
 */
let _countAllCache = null;
let _countAllCacheTime = 0;

function countAllSubagents() {
  const now = Date.now();
  if (_countAllCache !== null && (now - _countAllCacheTime) < CACHE_TTL_MS) {
    return _countAllCache;
  }

  const db = getReadDb();
  const rows = db.prepare(`
    SELECT chat_message
    FROM message_nodes
    WHERE chat_message LIKE '%"name":"run_subagent"%'
    ORDER BY row_id ASC
    LIMIT 10000
  `).all();

  const seen = new Set();
  for (const row of rows) {
    let msg;
    try { msg = JSON.parse(row.chat_message); } catch { continue; }
    if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;
    for (const tc of msg.tool_calls) {
      const name = tc?.name || tc?.function?.name;
      if (name === 'run_subagent' && tc.id) seen.add(tc.id);
    }
  }
  _countAllCache = seen.size;
  _countAllCacheTime = now;
  return _countAllCache;
}

/**
 * Returns a Set of session IDs that have at least one run_subagent tool call.
 * Cached for 60 seconds to avoid hitting the DB on every 3s poll cycle.
 *
 * @returns {Set<string>}
 */
let _sessionsWithSubagentsCache = null;
let _sessionsWithSubagentsCacheTime = 0;

function sessionsWithSubagents() {
  const now = Date.now();
  if (_sessionsWithSubagentsCache && (now - _sessionsWithSubagentsCacheTime) < CACHE_TTL_MS) {
    return _sessionsWithSubagentsCache;
  }

  const db = getReadDb();
  const rows = db.prepare(`
    SELECT DISTINCT session_id
    FROM message_nodes
    WHERE chat_message LIKE '%"name":"run_subagent"%'
      AND chat_message LIKE '%"role":"assistant"%'
  `).all();

  _sessionsWithSubagentsCache = new Set(rows.map(r => r.session_id));
  _sessionsWithSubagentsCacheTime = now;
  return _sessionsWithSubagentsCache;
}

module.exports = { extractSubagents, countSubagents, countAllSubagents, sessionsWithSubagents };

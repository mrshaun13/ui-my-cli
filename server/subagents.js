/**
 * Codex subagent lifecycle extraction.
 *
 * Codex records parent-side `sub_agent_activity` events in rollout JSONL and
 * stores each child as its own thread. We combine those two sources to expose
 * the same structured timeline contract used by the dashboard UI.
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const { resolveStateDbPath, findRolloutPath } = require('./codex-paths');

function json(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function epoch(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => part?.text || part?.content || '').filter(Boolean).join('\n');
}

function assistantText(payload) {
  if (!payload) return '';
  if (payload.type === 'message' && payload.role === 'assistant') return textFromContent(payload.content);
  if (payload.type === 'agent_message') return payload.message || payload.text || '';
  return '';
}

function truncate(value, max = 600) {
  if (!value || value.length <= max) return value || null;
  return `${value.slice(0, max - 1)}…`;
}

function readLines(pathname) {
  if (!pathname) return [];
  try { return fs.readFileSync(pathname, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch { return []; }
}

function threadRows(ids) {
  if (!ids.length) return new Map();
  const db = new Database(resolveStateDbPath(), { readonly: true, fileMustExist: true });
  try {
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
    const select = [
      'id',
      columns.has('rollout_path') ? 'rollout_path' : "'' AS rollout_path",
      columns.has('updated_at') ? 'updated_at' : '0 AS updated_at',
      columns.has('agent_nickname') ? 'agent_nickname' : "'' AS agent_nickname",
      columns.has('agent_role') ? 'agent_role' : "'' AS agent_role",
    ].join(', ');
    const placeholders = ids.map(() => '?').join(',');
    return new Map(db.prepare(`SELECT ${select} FROM threads WHERE id IN (${placeholders})`).all(...ids)
      .map(row => [row.id, row]));
  } finally {
    db.close();
  }
}

function childResult(row) {
  if (!row) return null;
  const pathname = row.rollout_path && fs.existsSync(row.rollout_path)
    ? row.rollout_path
    : findRolloutPath(row.id);
  let result = null;
  for (const line of readLines(pathname)) {
    const event = json(line);
    if (!event) continue;
    const text = event.type === 'response_item'
      ? assistantText(event.payload)
      : event.type === 'event_msg' && event.payload?.type === 'agent_message'
        ? event.payload.message || event.payload.text || ''
        : '';
    if (text) result = text;
  }
  return truncate(result);
}

function parseSubagentsFromLines(lines, childThreads = new Map()) {
  const launches = new Map();
  const activity = new Map();
  const spawnCalls = new Map();

  for (const line of lines) {
    const event = typeof line === 'string' ? json(line) : line;
    if (!event) continue;
    const payload = event.payload || {};
    if (event.type === 'response_item' && payload.type === 'function_call' && payload.name === 'spawn_agent') {
      const args = json(payload.arguments, {});
      spawnCalls.set(payload.call_id, {
        title: args.task_name || 'subagent',
        task: args.task_name ? `Delegated task: ${args.task_name.replaceAll('_', ' ')}` : null,
      });
      continue;
    }
    if (event.type !== 'event_msg' || payload.type !== 'sub_agent_activity') continue;
    const timestamp = payload.occurred_at_ms
      ? Math.floor(payload.occurred_at_ms / 1000)
      : epoch(event.timestamp);
    if (payload.kind === 'started') {
      const spawn = spawnCalls.get(payload.event_id) || {};
      const pathName = (payload.agent_path || '').split('/').filter(Boolean).pop();
      launches.set(payload.agent_thread_id, {
        eventId: payload.event_id,
        agentId: payload.agent_thread_id,
        title: spawn.title || pathName || payload.agent_thread_id,
        task: spawn.task,
        startedAt: timestamp,
        path: payload.agent_path || null,
      });
    }
    if (payload.agent_thread_id && timestamp) activity.set(payload.agent_thread_id, timestamp);
  }

  return [...launches.values()].map((launch, index) => {
    const child = childThreads.get(launch.agentId);
    const resultPreview = child?.resultPreview ?? childResult(child);
    const lastActivity = Math.max(activity.get(launch.agentId) || 0, child?.updated_at || child?.updatedAt || 0);
    const completedAt = resultPreview && lastActivity >= launch.startedAt ? lastActivity : null;
    return {
      id: launch.eventId || launch.agentId,
      agentId: launch.agentId,
      title: launch.title.replaceAll('_', ' '),
      profile: child?.agent_role || child?.agentRole || 'subagent_general',
      nickname: child?.agent_nickname || child?.nickname || launch.title,
      task: launch.task,
      resultPreview,
      startedAt: launch.startedAt,
      completedAt,
      durationSec: completedAt ? Math.max(0, completedAt - launch.startedAt) : null,
      isBackground: true,
      status: completedAt ? 'completed' : 'running',
      path: launch.path,
      order: index,
    };
  }).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}

function parentRolloutPath(sessionId) {
  const db = new Database(resolveStateDbPath(), { readonly: true, fileMustExist: true });
  try {
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
    const rollout = columns.has('rollout_path')
      ? db.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(sessionId)?.rollout_path
      : null;
    return rollout && fs.existsSync(rollout) ? rollout : findRolloutPath(sessionId);
  } finally {
    db.close();
  }
}

function extractSubagents(sessionId) {
  const lines = readLines(parentRolloutPath(sessionId));
  const childIds = [];
  for (const line of lines) {
    const event = json(line);
    if (event?.type === 'event_msg'
      && event.payload?.type === 'sub_agent_activity'
      && event.payload?.kind === 'started'
      && event.payload?.agent_thread_id) childIds.push(event.payload.agent_thread_id);
  }
  return parseSubagentsFromLines(lines, threadRows([...new Set(childIds)]));
}

function countSubagents(sessionId) {
  return extractSubagents(sessionId).length;
}

function countAllSubagents() {
  return 0;
}

function sessionsWithSubagents() {
  return new Set();
}

module.exports = {
  extractSubagents,
  countSubagents,
  countAllSubagents,
  sessionsWithSubagents,
  parseSubagentsFromLines,
};

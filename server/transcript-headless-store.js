/**
 * Read-only adapter for transcript-pipeline headless session ledgers.
 *
 * These runs are launched by transcript-pipeline, not by an interactive Codex
 * client, so they do not reliably appear in Codex's native thread database.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const dashboardStore = require('./dashboard-store');

const ID_PREFIX = 'tp:';
const DEFAULT_CONTEXT = 200000;
const IN_FLIGHT_RUN_STALE_SEC = 24 * 60 * 60;

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function relativeTime(epochSec) {
  if (!epochSec) return 'unknown';
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - epochSec);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function rootDir() {
  if (process.env.TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR) {
    return process.env.TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR;
  }
  const pipelineDir = process.env.TRANSCRIPT_PIPELINE_DIR
    || path.join(os.homedir(), 'git', 'ai-tell-my-story', 'transcript-pipeline');
  return path.join(pipelineDir, 'data', 'headless-sessions');
}

function isTranscriptHeadlessId(id) {
  return typeof id === 'string' && id.startsWith(ID_PREFIX);
}

function externalId(sessionName) {
  return `${ID_PREFIX}${sessionName}`;
}

function sessionNameFromId(id) {
  return isTranscriptHeadlessId(id) ? id.slice(ID_PREFIX.length) : id;
}

function safeJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function safeText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function epoch(value) {
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function mtimeEpoch(file) {
  try { return Math.floor(fs.statSync(file).mtimeMs / 1000); } catch { return 0; }
}

function truncate(value, max = 600) {
  if (!value || value.length <= max) return value || null;
  return `${value.slice(0, max - 1)}…`;
}

function listSessionDirs() {
  const root = rootDir();
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name));
}

function listRunDirs(sessionDir) {
  const runsDir = path.join(sessionDir, 'runs');
  let entries;
  try { entries = fs.readdirSync(runsDir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(runsDir, entry.name));
}

function readEvents(file) {
  const result = {
    path: fs.existsSync(file) ? file : null,
    totalEvents: 0,
    messages: [],
    turns: [],
    tools: [],
    errors: [],
    usage: null,
    threadId: null,
  };

  const raw = safeText(file);
  if (!raw) return result;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    result.totalEvents++;
    if (event.thread_id) result.threadId = event.thread_id;

    if (event.type === 'thread.started' && event.thread_id) {
      result.threadId = event.thread_id;
      continue;
    }

    if (event.type === 'turn.completed') {
      result.usage = event.usage || result.usage;
      continue;
    }

    const item = event.item || {};
    if (event.type === 'item.completed' && item.type === 'agent_message' && item.text) {
      result.messages.push({ role: 'assistant', text: item.text, createdAt: null });
      continue;
    }

    if (item.type === 'command_execution') {
      result.tools.push({
        name: 'command_execution',
        command: item.command || null,
        status: item.status || null,
        exitCode: item.exit_code ?? null,
      });
      if (item.exit_code && item.exit_code !== 0) {
        result.errors.push({ type: 'command_execution', message: item.aggregated_output || item.command || '' });
      }
    }
  }

  let current = null;
  for (const msg of result.messages) {
    if (!current) current = { userText: '', assistantText: msg.text, createdAt: msg.createdAt, assistantCreatedAt: msg.createdAt };
    else current.assistantText = msg.text;
  }
  if (current) result.turns.push(current);

  return result;
}

function readRun(sessionDir, runDir) {
  const status = safeJson(path.join(runDir, 'status.json')) || {};
  const prompt = safeText(path.join(runDir, 'prompt.txt')).trim();
  const lastMessage = safeText(path.join(runDir, 'last-message.txt')).trim();
  const events = readEvents(path.join(runDir, 'events.jsonl'));
  if (prompt) {
    if (events.turns.length) events.turns[0].userText = prompt;
    else events.turns.push({ userText: prompt, assistantText: lastMessage || '', createdAt: epoch(status.started_at), assistantCreatedAt: epoch(status.ended_at) });
  }
  if (lastMessage && !events.messages.some(msg => msg.role === 'assistant' && msg.text === lastMessage)) {
    events.messages.push({ role: 'assistant', text: lastMessage, createdAt: epoch(status.ended_at) });
    if (events.turns.length && !events.turns[events.turns.length - 1].assistantText) {
      events.turns[events.turns.length - 1].assistantText = lastMessage;
    }
  }

  const startedAt = epoch(status.started_at) || mtimeEpoch(path.join(runDir, 'status.json'));
  const endedAt = epoch(status.ended_at);
  const lastActivityAt = endedAt || mtimeEpoch(path.join(runDir, 'events.jsonl')) || startedAt;

  return {
    id: status.run_id || path.basename(runDir),
    dir: runDir,
    status,
    prompt,
    lastMessage,
    events,
    startedAt,
    endedAt,
    lastActivityAt,
  };
}

function latestRun(sessionDir, meta) {
  const runDirs = listRunDirs(sessionDir);
  if (!runDirs.length) return null;
  if (meta?.current_run_id) {
    const currentDir = path.join(sessionDir, 'runs', meta.current_run_id);
    if (fs.existsSync(currentDir)) return readRun(sessionDir, currentDir);
  }
  return runDirs
    .map(runDir => readRun(sessionDir, runDir))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0] || null;
}

function readRecord(sessionDir) {
  const meta = safeJson(path.join(sessionDir, 'meta.json')) || {};
  const sessionName = meta.session_name || path.basename(sessionDir);
  const run = latestRun(sessionDir, meta);
  return { sessionName, sessionDir, meta, run };
}

function normalizeRecord(record, overrides = dashboardStore.titleOverrides(), hidden = false) {
  const id = externalId(record.sessionName);
  const run = record.run;
  const status = run?.status || {};
  const runtime = status.runtime_metadata || {};
  const title = overrides.get(id) || record.sessionName;
  const lastActivityAt = run?.lastActivityAt || epoch(record.meta.updated_at) || epoch(record.meta.created_at);
  const createdAt = epoch(record.meta.created_at) || run?.startedAt || lastActivityAt;
  const exitCode = status.exit_code;
  const sourceId = record.meta.source_id || record.sessionName;
  const snippet = run?.lastMessage
    || [...(run?.events?.messages || [])].reverse().find(msg => msg.role === 'assistant')?.text
    || run?.prompt
    || null;

  let activityStatus = 'idle';
  if (run && !run.endedAt && exitCode == null
    && Math.floor(Date.now() / 1000) - lastActivityAt <= IN_FLIGHT_RUN_STALE_SEC) {
    activityStatus = 'active';
  }
  else if (exitCode === 0) activityStatus = 'finished';
  const state = hidden ? 'archived' : activityStatus;

  return {
    id,
    provider: 'codex',
    source: 'transcript-pipeline',
    threadSource: 'headless',
    title,
    workingDir: record.sessionDir,
    project: 'transcript-pipeline',
    model: status.model || 'codex',
    reasoningEffort: status.reasoning_effort || runtime.reasoning_effort || null,
    sandboxPolicy: status.runtime_profile || null,
    approvalMode: runtime.spawn_args?.includes('--dangerously-bypass-approvals-and-sandbox') ? 'danger-full-access' : 'never',
    memoryMode: null,
    status: state,
    ...(hidden ? { activityStatus } : {}),
    snippet: truncate(snippet),
    firstUserPrompt: truncate(run?.prompt),
    lastUserPrompt: truncate(run?.prompt),
    hasSubagents: false,
    archived: hidden,
    lastActivityAt,
    lastActivityAgo: relativeTime(lastActivityAt),
    createdAt,
    gitBranch: null,
    gitSha: null,
    sourceId,
    runId: run?.id || null,
    externalKind: status.kind || status.intent || null,
  };
}

function allRecords() {
  return listSessionDirs()
    .map(readRecord)
    .filter(record => record.run?.status?.runtime_metadata?.agent_id === 'codex');
}

function findRecord(id) {
  const sessionName = sessionNameFromId(id);
  const sessionDir = path.join(rootDir(), sessionName);
  if (!fs.existsSync(sessionDir)) return null;
  const record = readRecord(sessionDir);
  return record.run ? record : null;
}

function listSessions() {
  const hidden = dashboardStore.hiddenSessions();
  const overrides = dashboardStore.titleOverrides();
  return allRecords()
    .map(record => normalizeRecord(record, overrides, hidden.has(externalId(record.sessionName))))
    .filter(session => !session.archived)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function listArchivedSessions() {
  const hidden = dashboardStore.hiddenSessions();
  const overrides = dashboardStore.titleOverrides();
  return allRecords()
    .filter(record => hidden.has(externalId(record.sessionName)))
    .map(record => normalizeRecord(record, overrides, true))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function getSession(id) {
  const record = findRecord(id);
  if (!record) return null;
  return normalizeRecord(record, dashboardStore.titleOverrides(), dashboardStore.isHidden(externalId(record.sessionName)));
}

function tokenUsage(raw = {}) {
  const inputTokens = Number(raw.input_tokens || 0);
  const cachedInputTokens = Number(raw.cached_input_tokens || 0);
  const outputTokens = Number(raw.output_tokens || 0);
  const reasoningOutputTokens = Number(raw.reasoning_output_tokens || 0);
  return {
    inputTokens: Math.max(0, inputTokens - cachedInputTokens),
    totalInputTokens: inputTokens,
    cachedInputTokens,
    cacheReadTokens: cachedInputTokens,
    cacheWriteTokens: 0,
    outputTokens,
    visibleOutputTokens: Math.max(0, outputTokens - reasoningOutputTokens),
    reasoningOutputTokens,
    unclassifiedTokens: 0,
    totalTokens: Number(raw.total_tokens || inputTokens + outputTokens),
    calls: raw ? 1 : 0,
  };
}

function topTools(events) {
  const counts = {};
  for (const tool of events.tools || []) counts[tool.name || 'tool'] = (counts[tool.name || 'tool'] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));
}

function getSessionPreview(id) {
  const record = findRecord(id);
  if (!record) return null;
  const session = getSession(id);
  const run = record.run;
  const tokens = tokenUsage(run.events.usage || {});
  const durationSec = Math.max(0, (run.endedAt || run.lastActivityAt) - (run.startedAt || session.createdAt));

  return {
    ...session,
    startingModel: session.model,
    currentModel: session.model,
    modelSwitches: [],
    permissionMode: session.approvalMode || 'unknown',
    backendType: 'transcript-pipeline',
    source: 'transcript-pipeline',
    createdAtStr: session.createdAt ? new Date(session.createdAt * 1000).toLocaleString() : 'unknown',
    durationSec,
    durationStr: formatDuration(durationSec),
    projectDurationStr: formatDuration(durationSec),
    totalNodes: run.events.totalEvents,
    userMsgCount: run.prompt ? 1 : 0,
    assistantMsgCount: run.events.messages.filter(msg => msg.role === 'assistant').length,
    toolCallCount: run.events.tools.length,
    compactionCount: 0,
    peakContextTokens: tokens.totalTokens,
    modelContextWindow: DEFAULT_CONTEXT,
    topTools: topTools(run.events),
    subagentCount: 0,
    ...tokens,
    chatThread: run.events.turns.slice(-5),
    rolloutPath: run.events.path || path.join(run.dir, 'output.log'),
    sandboxPolicy: session.sandboxPolicy,
    approvalMode: session.approvalMode,
    memoryMode: null,
    gitBranch: null,
    gitSha: null,
  };
}

function getSessionConversation(id, offset = 0, limit = 50) {
  const record = findRecord(id);
  if (!record) return null;
  const turns = record.run.events.turns.filter(turn => turn.userText || turn.assistantText);
  const totalTurns = turns.length;
  let sliced;
  if (limit === 0) {
    sliced = turns;
  } else {
    const end = totalTurns - offset;
    const start = Math.max(0, end - limit);
    sliced = turns.slice(start, Math.max(end, 0));
  }
  return {
    turns: sliced,
    totalTurns,
    hasMore: limit === 0 ? false : (totalTurns - offset - sliced.length) > 0,
  };
}

function getSessionContextBreakdown(id) {
  const record = findRecord(id);
  if (!record) return null;
  const userMessages = record.run.prompt.length;
  const assistantMessages = record.run.events.messages.reduce((sum, msg) => sum + msg.text.length, 0);
  const toolCalls = JSON.stringify(record.run.events.tools).length;
  const totalChars = userMessages + assistantMessages + toolCalls;
  const totalUsed = Math.min(DEFAULT_CONTEXT, Math.max(record.run.events.usage?.total_tokens || 0, Math.ceil(totalChars / 4)));
  const categories = {
    systemPrompt: 0,
    userMessages: totalChars ? Math.round((userMessages / totalChars) * totalUsed) : 0,
    assistantMessages: totalChars ? Math.round((assistantMessages / totalChars) * totalUsed) : 0,
    toolCalls: totalChars ? Math.round((toolCalls / totalChars) * totalUsed) : 0,
    toolResults: 0,
  };
  return {
    categories,
    totalUsed,
    maxContext: DEFAULT_CONTEXT,
    freeTokens: Math.max(0, DEFAULT_CONTEXT - totalUsed),
    compactionCount: 0,
    model: record.run.status.model || 'codex',
  };
}

function getSessionConfig(id) {
  const record = findRecord(id);
  if (!record) return null;
  const runtime = record.run.status.runtime_metadata || {};
  const permissions = [];
  if (record.run.status.runtime_profile) permissions.push({ scope: 'runtime profile', action: record.run.status.runtime_profile });
  if (runtime.spawn_args?.length) permissions.push({ scope: 'spawn args', action: runtime.spawn_args.join(' ') });
  return {
    rules: [],
    activeSkills: [],
    permissions,
    model: record.run.status.model || null,
    permissionMode: runtime.spawn_args?.includes('--dangerously-bypass-approvals-and-sandbox') ? 'danger-full-access' : 'never',
  };
}

function hideSession(id) {
  return dashboardStore.hideSession(id);
}

function restoreSession(id) {
  return dashboardStore.restoreSession(id);
}

function listRepos() {
  const dir = rootDir();
  return fs.existsSync(dir) ? [{ workingDir: path.dirname(path.dirname(dir)), project: 'transcript-pipeline' }] : [];
}

function listSessionIds() {
  return new Set(allRecords().map(record => externalId(record.sessionName)));
}

function searchSessions(query, includeArchived) {
  const q = (query || '').toLowerCase();
  const hidden = dashboardStore.hiddenSessions();
  const overrides = dashboardStore.titleOverrides();
  return allRecords()
    .map(record => ({ record, session: normalizeRecord(record, overrides, hidden.has(externalId(record.sessionName))) }))
    .filter(({ session }) => includeArchived || !session.archived)
    .filter(({ record, session }) => [
      session.title,
      session.id,
      session.sourceId,
      session.runId,
      record.run?.prompt,
      session.snippet,
    ].filter(Boolean).join('\n').toLowerCase().includes(q))
    .map(({ session }) => session);
}

function latestPrompt() {
  const record = allRecords()
    .filter(item => !dashboardStore.isHidden(externalId(item.sessionName)))
    .sort((a, b) => (b.run?.lastActivityAt || 0) - (a.run?.lastActivityAt || 0))[0];
  if (!record?.run?.prompt) return null;
  const session = normalizeRecord(record);
  return {
    sessionId: session.id,
    title: session.title,
    project: session.project,
    prompt: record.run.prompt,
    timestamp: session.lastActivityAt,
  };
}

function stats() {
  const sessions = listSessions();
  const sources = sessions.length ? { 'transcript-pipeline': sessions.length } : {};
  return { activity: { total: sessions.length }, sources };
}

module.exports = {
  ID_PREFIX,
  isTranscriptHeadlessId,
  listSessions,
  listArchivedSessions,
  getSession,
  getSessionPreview,
  getSessionConversation,
  getSessionContextBreakdown,
  getSessionConfig,
  hideSession,
  restoreSession,
  listRepos,
  listSessionIds,
  searchSessions,
  latestPrompt,
  stats,
};

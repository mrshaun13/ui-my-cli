/**
 * Codex session adapter.
 *
 * Reads Codex's local thread state and rollout JSONL history, then exposes the
 * dashboard's existing session-oriented API shape. Native thread titles are
 * kept in Codex's own state database so CLI, VS Code, and this dashboard agree.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { resolveCodexHome, resolveStateDbPath, findRolloutPath } = require('./codex-paths');
const dashboardStore = require('./dashboard-store');
const transcriptHeadless = require('./transcript-headless-store');
const { buildUsageRollups, pricingMetadata } = require('./codex-usage-rollups');
const { estimateCredits } = require('./codex-pricing');
const {
  emptyTokenWindows,
  emptyTokenHeatmap,
  addTokenActivity,
} = require('./codex-token-activity');

const USER_SOURCES = new Set(['cli', 'vscode']);
const DEFAULT_CONTEXT = 200000;
const HEADLESS_PREFIX_RE = /^headless-\d{8}-/;
const HEADLESS_STAMP_RE = /--(?:triage|continue|workflow|research-visualizer|interview-me|generate-presentation)-\d{4}-\d{2}-\d{2}T/;
const rolloutSummaryCache = new Map();
const statsResultCache = new Map();
const SUMMARY_READ_CHUNK_BYTES = 1024 * 1024;

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

function projectName(cwd) {
  if (!cwd) return 'unknown';
  return path.basename(cwd.replace(/[\\/]+$/, '')) || 'unknown';
}

function getReadDb() {
  return new Database(resolveStateDbPath(), { readonly: true, fileMustExist: true });
}

function getWriteDb() {
  const db = new Database(resolveStateDbPath(), { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function threadSelect(db) {
  const columns = db.prepare('PRAGMA table_info(threads)').all().map(row => row.name);
  const select = [
    'id',
    columns.includes('rollout_path') ? 'rollout_path' : "'' AS rollout_path",
    columns.includes('created_at') ? 'created_at' : '0 AS created_at',
    columns.includes('updated_at') ? 'updated_at' : '0 AS updated_at',
    columns.includes('source') ? 'source' : "'cli' AS source",
    columns.includes('thread_source') ? 'thread_source' : "'user' AS thread_source",
    columns.includes('model_provider') ? 'model_provider' : "'openai' AS model_provider",
    columns.includes('cwd') ? 'cwd' : "'' AS cwd",
    columns.includes('title') ? 'title' : "'' AS title",
    columns.includes('sandbox_policy') ? 'sandbox_policy' : "'' AS sandbox_policy",
    columns.includes('approval_mode') ? 'approval_mode' : "'' AS approval_mode",
    columns.includes('archived') ? 'archived' : '0 AS archived',
    columns.includes('first_user_message') ? 'first_user_message' : "'' AS first_user_message",
    columns.includes('model') ? 'model' : "'' AS model",
    columns.includes('reasoning_effort') ? 'reasoning_effort' : "'' AS reasoning_effort",
    columns.includes('preview') ? 'preview' : "'' AS preview",
    columns.includes('memory_mode') ? 'memory_mode' : "'' AS memory_mode",
    columns.includes('agent_nickname') ? 'agent_nickname' : "'' AS agent_nickname",
    columns.includes('agent_role') ? 'agent_role' : "'' AS agent_role",
    columns.includes('tokens_used') ? 'tokens_used' : '0 AS tokens_used',
    columns.includes('git_sha') ? 'git_sha' : "'' AS git_sha",
    columns.includes('git_branch') ? 'git_branch' : "'' AS git_branch",
    columns.includes('git_origin_url') ? 'git_origin_url' : "'' AS git_origin_url",
  ];
  return select.join(', ');
}

function listThreads({ includeArchived = false, includeSystem = false } = {}) {
  const db = getReadDb();
  try {
    const rows = db.prepare(`
      SELECT ${threadSelect(db)}
      FROM threads
      ORDER BY updated_at DESC, id DESC
    `).all();
    return rows.filter(row => {
      if (!includeArchived && row.archived) return false;
      if (!includeSystem && !USER_SOURCES.has(row.source)) return false;
      return true;
    });
  } finally {
    db.close();
  }
}

function getThread(id, { includeArchived = true, includeSystem = true } = {}) {
  const db = getReadDb();
  try {
    const row = db.prepare(`
      SELECT ${threadSelect(db)}
      FROM threads
      WHERE id = ?
    `).get(id);
    if (!row) return null;
    if (!includeArchived && row.archived) return null;
    if (!includeSystem && !USER_SOURCES.has(row.source)) return null;
    return row;
  } finally {
    db.close();
  }
}

function rolloutPathFor(thread) {
  if (thread?.rollout_path && fs.existsSync(thread.rollout_path)) return thread.rollout_path;
  return thread?.id ? findRolloutPath(thread.id) : null;
}

function parseJsonLine(line) {
  if (!line.trim()) return null;
  try { return JSON.parse(line); } catch { return null; }
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      return part?.text || part?.content || '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object') return content.text || content.message || '';
  return '';
}

function responseMessage(payload) {
  if (!payload || payload.type !== 'message') return null;
  const role = payload.role;
  const text = Array.isArray(payload.content)
    ? payload.content.map(item => textFromContent(item?.text ?? item?.content ?? item)).filter(Boolean).join('\n')
    : textFromContent(payload.content);
  return text ? { role, text, createdAt: null, source: 'response_item' } : null;
}

function eventMessage(payload) {
  if (!payload?.message) return null;
  if (payload.type === 'user_message') return { role: 'user', text: payload.message, createdAt: null, source: 'event_msg' };
  if (payload.type === 'agent_message') return { role: 'assistant', text: payload.message, createdAt: null, source: 'event_msg' };
  return null;
}

function extractToolName(payload) {
  if (!payload) return null;
  return payload.name || payload.tool_name || payload.recipient_name || payload.tool || null;
}

function normalizeMessageText(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function isDuplicateMessage(a, b) {
  if (!a || !b) return false;
  if (a.role !== b.role) return false;
  if (normalizeMessageText(a.text) !== normalizeMessageText(b.text)) return false;
  if (!a.createdAt || !b.createdAt) return true;
  return Math.abs(a.createdAt - b.createdAt) <= 2;
}

function appendMessage(messages, msg) {
  if (!msg?.text) return;
  const recentStart = Math.max(0, messages.length - 4);
  const existingOffset = messages.slice(recentStart).findIndex(existing => isDuplicateMessage(existing, msg));
  const existingIndex = existingOffset === -1 ? -1 : recentStart + existingOffset;
  if (existingIndex === -1) {
    messages.push(msg);
    return;
  }

  // Codex writes both response_item messages and event_msg mirrors. Prefer the
  // response_item copy when both exist because it is the canonical transcript.
  const existing = messages[existingIndex];
  if (existing.source !== 'response_item' && msg.source === 'response_item') {
    messages[existingIndex] = { ...msg, createdAt: existing.createdAt || msg.createdAt };
  }
}

function emptyRolloutSummary(pathname) {
  return {
    path: pathname,
    metadata: {},
    runtime: {},
    firstUser: null,
    lastUser: null,
    lastAssistant: null,
    subagentIds: new Set(),
  };
}

function applySummaryEvent(summary, event) {
  if (!event) return;
  if (event.type === 'session_meta') {
    summary.metadata = { ...summary.metadata, ...(event.payload || {}) };
    return;
  }
  if (event.type === 'turn_context') {
    const payload = event.payload || {};
    summary.runtime = {
      approvalMode: payload.approval_policy || summary.runtime.approvalMode || null,
      sandboxPolicy: payload.sandbox_policy || summary.runtime.sandboxPolicy || null,
      permissionProfile: payload.permission_profile || summary.runtime.permissionProfile || null,
    };
    return;
  }
  if (event.type === 'event_msg'
    && event.payload?.type === 'sub_agent_activity'
    && event.payload?.kind === 'started'
    && event.payload?.agent_thread_id) {
    summary.subagentIds.add(event.payload.agent_thread_id);
  }

  const msg = event.type === 'response_item'
    ? responseMessage(event.payload || {})
    : event.type === 'event_msg'
      ? eventMessage(event.payload || {})
      : null;
  if (msg?.role === 'user') {
    summary.firstUser ||= msg.text;
    summary.lastUser = msg.text;
  } else if (msg?.role === 'assistant') {
    summary.lastAssistant = msg.text;
  }
}

function publicRolloutSummary(entry) {
  const messages = [];
  if (entry.summary.firstUser) messages.push({ role: 'user', text: entry.summary.firstUser });
  if (entry.summary.lastUser && entry.summary.lastUser !== entry.summary.firstUser) {
    messages.push({ role: 'user', text: entry.summary.lastUser });
  }
  if (entry.summary.lastAssistant) messages.push({ role: 'assistant', text: entry.summary.lastAssistant });
  return {
    path: entry.summary.path,
    metadata: entry.summary.metadata,
    runtime: entry.summary.runtime,
    messages,
    subagentCount: entry.summary.subagentIds.size,
  };
}

/**
 * Session lists only need a few rollout fields. Keep an incremental summary so
 * the status feed does not reparse every JSONL file from byte zero each tick.
 */
function readRolloutSummary(thread) {
  const file = rolloutPathFor(thread);
  if (!file) return publicRolloutSummary({ summary: emptyRolloutSummary(null) });

  let stat;
  try { stat = fs.statSync(file); } catch {
    rolloutSummaryCache.delete(file);
    return publicRolloutSummary({ summary: emptyRolloutSummary(file) });
  }

  let entry = rolloutSummaryCache.get(file);
  const fileIdentity = `${stat.dev}:${stat.ino}`;
  if (!entry || entry.fileIdentity !== fileIdentity || stat.size < entry.offset) {
    entry = {
      fileIdentity,
      offset: 0,
      carry: Buffer.alloc(0),
      summary: emptyRolloutSummary(file),
    };
  }
  if (stat.size === entry.offset) {
    rolloutSummaryCache.set(file, entry);
    return publicRolloutSummary(entry);
  }

  let fd;
  try {
    fd = fs.openSync(file, 'r');
    while (entry.offset < stat.size) {
      const length = Math.min(SUMMARY_READ_CHUNK_BYTES, stat.size - entry.offset);
      const chunk = Buffer.allocUnsafe(length);
      const bytesRead = fs.readSync(fd, chunk, 0, length, entry.offset);
      if (!bytesRead) break;
      entry.offset += bytesRead;
      const data = entry.carry.length
        ? Buffer.concat([entry.carry, chunk.subarray(0, bytesRead)])
        : chunk.subarray(0, bytesRead);
      let lineStart = 0;
      for (let index = 0; index < data.length; index++) {
        if (data[index] !== 0x0a) continue;
        let line = data.subarray(lineStart, index);
        if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, -1);
        applySummaryEvent(entry.summary, parseJsonLine(line.toString('utf8')));
        lineStart = index + 1;
      }
      entry.carry = lineStart < data.length ? Buffer.from(data.subarray(lineStart)) : Buffer.alloc(0);
    }
  } catch {
    // Keep the last complete summary; a later status tick will retry the tail.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  rolloutSummaryCache.set(file, entry);
  return publicRolloutSummary(entry);
}

function readRollout(thread) {
  const file = rolloutPathFor(thread);
  const result = {
    path: file,
    events: [],
    messages: [],
    turns: [],
    tools: [],
    errors: [],
    tokenEvents: [],
    metadata: {},
    runtime: {},
    modelSwitches: [],
    subagentEvents: [],
    startingModel: null,
    currentModel: null,
    currentReasoningEffort: null,
    totalEvents: 0,
  };
  if (!file) return result;

  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return result; }

  for (const line of lines) {
    const event = parseJsonLine(line);
    if (!event) continue;
    result.totalEvents++;
    result.events.push(event);

    const createdAt = event.timestamp ? Math.floor(Date.parse(event.timestamp) / 1000) : null;
    if (event.type === 'session_meta') {
      result.metadata = { ...result.metadata, ...(event.payload || {}) };
      continue;
    }
    if (event.type === 'turn_context') {
      const payload = event.payload || {};
      const model = payload.model || null;
      const reasoningEffort = payload.effort
        || payload.collaboration_mode?.settings?.reasoning_effort
        || null;
      if (model) {
        if (!result.startingModel) {
          result.startingModel = model;
          result.currentModel = model;
          result.currentReasoningEffort = reasoningEffort;
        } else if (model !== result.currentModel || reasoningEffort !== result.currentReasoningEffort) {
          result.modelSwitches.push({
            fromModel: result.currentModel,
            fromReasoningEffort: result.currentReasoningEffort,
            model,
            reasoningEffort,
            timestamp: createdAt,
            turnId: payload.turn_id || null,
          });
          result.currentModel = model;
          result.currentReasoningEffort = reasoningEffort;
        }
      }
      result.runtime = {
        approvalMode: payload.approval_policy || result.runtime.approvalMode || null,
        sandboxPolicy: payload.sandbox_policy || result.runtime.sandboxPolicy || null,
        permissionProfile: payload.permission_profile || result.runtime.permissionProfile || null,
      };
      continue;
    }

    let msg = null;
    if (event.type === 'response_item') {
      const payload = event.payload || {};
      msg = responseMessage(payload);
      const toolName = extractToolName(payload);
      if (payload.type === 'function_call' || toolName) {
        result.tools.push({
          name: toolName || 'tool',
          createdAt,
          arguments: payload.arguments || null,
        });
      }
      if (payload.type === 'function_call_output' && payload.output) {
        result.tools.push({ name: 'tool_output', createdAt, arguments: null });
      }
    } else if (event.type === 'event_msg') {
      if (event.payload?.type === 'sub_agent_activity') result.subagentEvents.push(event.payload);
      if (event.payload?.type === 'token_count') {
        result.tokenEvents.push({
          createdAt,
          total: event.payload.info?.total_token_usage || null,
          last: event.payload.info?.last_token_usage || null,
          model: result.currentModel,
          reasoningEffort: result.currentReasoningEffort,
          modelContextWindow: Number(event.payload.info?.model_context_window || 0),
          rateLimits: event.payload.rate_limits || null,
        });
      }
      msg = eventMessage(event.payload || {});
      if (event.payload?.type && /error|failed|approval/i.test(event.payload.type)) {
        result.errors.push({ type: event.payload.type, createdAt, message: event.payload.message || '' });
      }
    }

    if (msg?.text) {
      msg.createdAt = createdAt;
      appendMessage(result.messages, msg);
    }
  }

  let current = null;
  for (const msg of result.messages) {
    if (msg.role === 'user') {
      if (current) result.turns.push(current);
      current = { userText: msg.text, assistantText: null, createdAt: msg.createdAt, assistantCreatedAt: null };
    } else if (msg.role === 'assistant') {
      if (!current) {
        current = { userText: '', assistantText: msg.text, createdAt: msg.createdAt, assistantCreatedAt: msg.createdAt };
      } else {
        current.assistantText = msg.text;
        current.assistantCreatedAt = msg.createdAt;
      }
    }
  }
  if (current) result.turns.push(current);

  return result;
}

function statusFor(thread, rollout) {
  const lastActivity = thread.updated_at || thread.created_at || 0;
  const idleSec = Math.floor(Date.now() / 1000) - lastActivity;
  if (idleSec < 60) return 'active';
  if (idleSec > 600) return 'idle';
  const lastAssistant = [...(rollout?.messages || [])].reverse().find(m => m.role === 'assistant');
  if (lastAssistant?.text?.trimEnd().endsWith('?')) return 'question';
  return 'finished';
}

function isNativeHeadlessThread(thread) {
  const haystack = [
    thread.title,
    thread.cwd,
    thread.first_user_message,
    thread.preview,
    thread.id,
  ].filter(Boolean).join('\n');
  return HEADLESS_PREFIX_RE.test(thread.title || '')
    || HEADLESS_PREFIX_RE.test(path.basename(thread.cwd || ''))
    || HEADLESS_STAMP_RE.test(haystack);
}

function normalizeThread(thread, _overrides = null, rollout = null) {
  const parsed = rollout || readRolloutSummary(thread);
  const firstUser = thread.first_user_message || parsed.messages.find(m => m.role === 'user')?.text || null;
  const lastUser = [...parsed.messages].reverse().find(m => m.role === 'user')?.text || firstUser;
  const lastAssistant = [...parsed.messages].reverse().find(m => m.role === 'assistant')?.text || null;
  const title = thread.title || firstUser || thread.id.slice(0, 8);
  const access = accessProfile(thread, parsed);

  return {
    id: thread.id,
    provider: 'codex',
    source: thread.source || 'cli',
    threadSource: thread.thread_source || 'user',
    title,
    workingDir: thread.cwd || '',
    project: projectName(thread.cwd),
    model: thread.model || parsed.metadata.model || 'codex',
    reasoningEffort: thread.reasoning_effort || parsed.metadata.reasoning_effort || null,
    sandboxPolicy: access?.rawSandboxType || thread.sandbox_policy || null,
    approvalMode: access?.rawApprovalMode || thread.approval_mode || null,
    permissionMode: access?.label || null,
    memoryMode: thread.memory_mode || null,
    status: thread.archived ? 'archived' : statusFor(thread, parsed),
    snippet: thread.preview || lastAssistant || firstUser || null,
    firstUserPrompt: firstUser,
    lastUserPrompt: lastUser,
    hasSubagents: (parsed.subagentCount || parsed.subagentEvents?.filter(event => event.kind === 'started').length || 0) > 0,
    archived: !!thread.archived,
    lastActivityAt: thread.updated_at || thread.created_at || 0,
    lastActivityAgo: relativeTime(thread.updated_at || thread.created_at || 0),
    createdAt: thread.created_at || 0,
    gitBranch: thread.git_branch || null,
    gitSha: thread.git_sha || null,
  };
}

function listSessions() {
  return [
    ...listThreads({ includeArchived: false, includeSystem: false })
      .map(thread => normalizeThread(thread)),
    ...transcriptHeadless.listSessions(),
  ].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function listArchivedSessions() {
  return [
    ...listThreads({ includeArchived: true, includeSystem: false })
      .filter(thread => !!thread.archived)
      .map(thread => normalizeThread(thread)),
    ...transcriptHeadless.listArchivedSessions(),
  ].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function getSession(id) {
  if (transcriptHeadless.isTranscriptHeadlessId(id)) return transcriptHeadless.getSession(id);
  const thread = getThread(id, { includeArchived: false, includeSystem: false });
  return thread ? normalizeThread(thread) : null;
}

function topTools(rollout, limit = 6) {
  const counts = {};
  for (const tool of rollout.tools) {
    const name = tool.name || 'tool';
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function tokenFromThread(thread) {
  return Number(thread.tokens_used || 0);
}

function numberField(object, field) {
  return Number(object?.[field] || 0);
}

function normalizeTokenUsage(raw = {}) {
  const totalInputTokens = numberField(raw, 'input_tokens');
  const cachedInputTokens = numberField(raw, 'cached_input_tokens');
  const outputTokens = numberField(raw, 'output_tokens');
  const reasoningOutputTokens = numberField(raw, 'reasoning_output_tokens');
  const inputTokens = Math.max(0, totalInputTokens - cachedInputTokens);
  const visibleOutputTokens = Math.max(0, outputTokens - reasoningOutputTokens);
  const reportedTotal = numberField(raw, 'total_tokens');
  const totalTokens = reportedTotal || totalInputTokens + outputTokens;

  return {
    inputTokens,
    totalInputTokens,
    cachedInputTokens,
    cacheReadTokens: cachedInputTokens,
    cacheWriteTokens: 0,
    outputTokens,
    visibleOutputTokens,
    reasoningOutputTokens,
    unclassifiedTokens: 0,
    totalTokens,
  };
}

function emptyTokenUsage(unclassifiedTokens = 0) {
  return {
    inputTokens: 0,
    totalInputTokens: 0,
    cachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    visibleOutputTokens: 0,
    reasoningOutputTokens: 0,
    unclassifiedTokens,
    totalTokens: unclassifiedTokens,
  };
}

function tokenTelemetry(rollout, thread) {
  const events = rollout?.tokenEvents || [];
  const latest = [...events].reverse().find(event => event.total);
  const fallbackTokens = tokenFromThread(thread);
  const usage = latest?.total ? normalizeTokenUsage(latest.total) : emptyTokenUsage(fallbackTokens);
  const peakContextTokens = events.reduce((max, event) => {
    const lastTotal = numberField(event.last, 'total_tokens');
    return Math.max(max, lastTotal);
  }, 0);
  const modelContextWindow = events.reduce((max, event) => Math.max(max, event.modelContextWindow || 0), 0);
  const latestRateLimits = [...events].reverse().find(event => event.rateLimits)?.rateLimits || null;

  return {
    ...usage,
    calls: events.length,
    peakContextTokens: peakContextTokens || usage.totalTokens || fallbackTokens,
    modelContextWindow: modelContextWindow || DEFAULT_CONTEXT,
    rateLimits: latestRateLimits,
    tokenTelemetrySource: latest ? 'codex.token_count' : (fallbackTokens ? 'threads.tokens_used' : 'none'),
  };
}

function usageRecordsForThread(thread, rollout, tokens = tokenTelemetry(rollout, thread)) {
  const session = {
    id: thread.id,
    title: thread.title || thread.id.slice(0, 8),
    model: rollout.currentModel || thread.model || 'codex',
    reasoningEffort: rollout.currentReasoningEffort || thread.reasoning_effort || 'unknown',
  };
  const project = projectName(thread.cwd);
  const records = (rollout.tokenEvents || [])
    .filter(event => event.last)
    .map(event => ({
      timestamp: event.createdAt || thread.updated_at || thread.created_at || 0,
      usage: { ...normalizeTokenUsage(event.last), calls: 1 },
      model: event.model || session.model,
      reasoningEffort: event.reasoningEffort || session.reasoningEffort,
      project,
      session,
    }));
  if (records.length === 0 && tokens.totalTokens > 0) {
    records.push({
      timestamp: thread.updated_at || thread.created_at || 0,
      usage: tokens,
      model: session.model,
      reasoningEffort: session.reasoningEffort,
      project,
      session,
    });
  }
  return records;
}

function sessionPricing(rollout, thread, tokens) {
  const totals = buildUsageRollups(usageRecordsForThread(thread, rollout, tokens)).all.totals;
  return {
    estimatedCredits: totals.estimatedCredits,
    pricedTokens: totals.pricedTokens,
    unpricedTokens: totals.unpricedTokens,
    pricingCoverage: totals.pricingCoverage,
  };
}

function runtimePolicy(thread, rollout = null) {
  const threadSandbox = thread?.sandbox_policy ? safeJson(thread.sandbox_policy) : null;
  return {
    approvalMode: rollout?.runtime?.approvalMode || thread?.approval_mode || null,
    sandboxPolicy: rollout?.runtime?.sandboxPolicy || threadSandbox || null,
    permissionProfile: rollout?.runtime?.permissionProfile || null,
  };
}

function sandboxType(policy) {
  if (!policy) return null;
  if (typeof policy === 'string') return policy;
  return policy.type || null;
}

function approvalLabel(mode) {
  switch (mode) {
    case 'never': return 'no approvals';
    case 'on-request': return 'asks on request';
    case 'on-failure': return 'asks on failure';
    case 'untrusted': return 'asks for untrusted actions';
    default: return mode || null;
  }
}

function sandboxLabel(type) {
  switch (type) {
    case 'danger-full-access':
    case 'disabled':
      return 'full access';
    case 'workspace-write':
      return 'workspace write';
    case 'read-only':
      return 'read only';
    default:
      return type || null;
  }
}

function accessProfile(thread, rollout = null) {
  const runtime = runtimePolicy(thread, rollout);
  const sandbox = sandboxLabel(sandboxType(runtime.sandboxPolicy));
  const approval = approvalLabel(runtime.approvalMode);
  if (!sandbox && !approval) return null;

  return {
    label: [sandbox, approval].filter(Boolean).join(', '),
    sandbox,
    approval,
    rawApprovalMode: runtime.approvalMode,
    rawSandboxType: sandboxType(runtime.sandboxPolicy),
    rawPermissionProfileType: sandboxType(runtime.permissionProfile),
  };
}

function getSessionPreview(id) {
  if (transcriptHeadless.isTranscriptHeadlessId(id)) {
    const preview = transcriptHeadless.getSessionPreview(id);
    if (!preview) return null;
    const pricing = estimateCredits(preview, preview.model);
    const coverageDenominator = pricing.pricedTokens + pricing.unpricedTokens;
    return {
      ...preview,
      ...pricing,
      pricingCoverage: coverageDenominator > 0 ? pricing.pricedTokens / coverageDenominator : 0,
    };
  }
  const thread = getThread(id, { includeArchived: true, includeSystem: false });
  if (!thread) return null;
  const rollout = readRollout(thread);
  const session = normalizeThread(thread, null, rollout);
  const durationSec = Math.max(0, (thread.updated_at || 0) - (thread.created_at || 0));
  const tokens = tokenTelemetry(rollout, thread);
  const pricing = sessionPricing(rollout, thread, tokens);
  const access = accessProfile(thread, rollout);

  return {
    ...session,
    startingModel: rollout.startingModel || session.model,
    currentModel: rollout.currentModel || session.model,
    modelSwitches: rollout.modelSwitches,
    reasoningEffort: rollout.currentReasoningEffort || session.reasoningEffort,
    permissionMode: access?.label || null,
    accessProfile: access,
    backendType: thread.source || 'local',
    source: thread.source || 'cli',
    createdAtStr: thread.created_at ? new Date(thread.created_at * 1000).toLocaleString() : 'unknown',
    durationStr: formatDuration(durationSec),
    projectDurationStr: formatDuration(projectDuration(thread.cwd)),
    totalNodes: rollout.totalEvents,
    userMsgCount: rollout.messages.filter(m => m.role === 'user').length,
    assistantMsgCount: rollout.messages.filter(m => m.role === 'assistant').length,
    toolCallCount: rollout.tools.length,
    compactionCount: rollout.events.filter(e => JSON.stringify(e).includes('compact')).length,
    peakContextTokens: tokens.peakContextTokens,
    modelContextWindow: tokens.modelContextWindow,
    topTools: topTools(rollout),
    subagentCount: new Set(rollout.subagentEvents
      .filter(event => event.kind === 'started')
      .map(event => event.agent_thread_id)
      .filter(Boolean)).size,
    ...tokens,
    ...pricing,
    chatThread: rollout.turns.slice(-5),
    rolloutPath: rollout.path,
    sandboxPolicy: access?.rawSandboxType || thread.sandbox_policy,
    approvalMode: access?.rawApprovalMode || thread.approval_mode,
    memoryMode: thread.memory_mode,
    gitBranch: thread.git_branch,
    gitSha: thread.git_sha,
  };
}

function projectDuration(cwd) {
  if (!cwd) return 0;
  return listThreads({ includeArchived: true, includeSystem: false })
    .filter(thread => thread.cwd === cwd)
    .reduce((sum, thread) => sum + Math.max(0, (thread.updated_at || 0) - (thread.created_at || 0)), 0);
}

function getSessionConversation(id, offset = 0, limit = 50) {
  if (transcriptHeadless.isTranscriptHeadlessId(id)) return transcriptHeadless.getSessionConversation(id, offset, limit);
  const thread = getThread(id, { includeArchived: true, includeSystem: false });
  if (!thread) return null;
  const turns = readRollout(thread).turns.filter(t => t.userText || t.assistantText);
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
  if (transcriptHeadless.isTranscriptHeadlessId(id)) return transcriptHeadless.getSessionContextBreakdown(id);
  const thread = getThread(id, { includeArchived: true, includeSystem: false });
  if (!thread) return null;
  const rollout = readRollout(thread);
  const charCounts = {
    systemPrompt: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: JSON.stringify(rollout.tools).length,
    toolResults: 0,
  };
  for (const msg of rollout.messages) {
    if (msg.role === 'user') charCounts.userMessages += msg.text.length;
    if (msg.role === 'assistant') charCounts.assistantMessages += msg.text.length;
  }

  const totalChars = Object.values(charCounts).reduce((a, b) => a + b, 0);
  const tokens = tokenTelemetry(rollout, thread);
  const maxContext = tokens.modelContextWindow || DEFAULT_CONTEXT;
  const totalUsed = Math.min(maxContext, Math.max(tokens.peakContextTokens, Math.ceil(totalChars / 4)));
  const categories = {};
  for (const [key, chars] of Object.entries(charCounts)) {
    categories[key] = totalChars > 0 ? Math.round((chars / totalChars) * totalUsed) : 0;
  }

  return {
    categories,
    totalUsed,
    maxContext,
    freeTokens: Math.max(0, maxContext - totalUsed),
    compactionCount: rollout.events.filter(e => JSON.stringify(e).includes('compact')).length,
    model: thread.model || 'codex',
  };
}

function getSessionConfig(id) {
  if (transcriptHeadless.isTranscriptHeadlessId(id)) return transcriptHeadless.getSessionConfig(id);
  const thread = getThread(id, { includeArchived: true, includeSystem: false });
  if (!thread) return null;
  const rollout = readRollout(thread);
  const access = accessProfile(thread, rollout);
  const permissions = [];
  if (access?.label) permissions.push({ scope: 'runtime access', action: access.label, label: access.label });
  if (access?.rawSandboxType && access.rawSandboxType !== 'danger-full-access' && access.rawSandboxType !== 'disabled') {
    permissions.push({ scope: 'sandbox', action: access.sandbox || access.rawSandboxType });
  }

  return {
    rules: [],
    activeSkills: [],
    permissions,
    model: thread.model || null,
    permissionMode: access?.label || null,
  };
}

function safeJson(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeNativeTitle(title) {
  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('title must be 1-200 characters without control characters');
  }
  return trimmed;
}

function renameSession(id, title) {
  if (transcriptHeadless.isTranscriptHeadlessId(id)) return dashboardStore.setTitle(id, title);

  const db = getWriteDb();
  try {
    const rename = db.transaction(() => {
      const thread = db.prepare(`
        SELECT id, title, first_user_message, preview
        FROM threads
        WHERE id = ? AND source IN ('cli', 'vscode')
      `).get(id);
      if (!thread) throw new Error('Codex session not found');

      const nextTitle = title === null
        ? (thread.first_user_message || thread.preview || thread.title || thread.id.slice(0, 8))
        : normalizeNativeTitle(title);
      db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(nextTitle, id);
      return { id, title: nextTitle };
    });
    const result = rename();
    // Remove any title written by older dashboard versions so stale metadata
    // cannot be mistaken for the native Codex title later.
    dashboardStore.setTitle(id, null);
    return result;
  } finally {
    db.close();
  }
}

function runCodexCommand(args) {
  execFileSync('codex', args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
}

function hideSession(id) {
  if (transcriptHeadless.isTranscriptHeadlessId(id)) return transcriptHeadless.hideSession(id);
  runCodexCommand(['archive', id]);
  return { id, archived: true };
}

function restoreSession(id) {
  if (transcriptHeadless.isTranscriptHeadlessId(id)) return transcriptHeadless.restoreSession(id);
  runCodexCommand(['unarchive', id]);
  return { id, archived: false };
}

function listRepos() {
  const seen = new Set();
  const repos = [];
  for (const repo of [
    ...listThreads({ includeArchived: true, includeSystem: false })
      .map(thread => ({ workingDir: thread.cwd, project: projectName(thread.cwd) })),
    ...transcriptHeadless.listRepos(),
  ]) {
    if (!repo.workingDir || seen.has(repo.workingDir)) continue;
    seen.add(repo.workingDir);
    repos.push(repo);
  }
  return repos.sort((a, b) => a.project.localeCompare(b.project));
}

function listSessionIds() {
  return new Set([
    ...listThreads({ includeArchived: true, includeSystem: false }).map(thread => thread.id),
    ...transcriptHeadless.listSessionIds(),
  ]);
}

function findNewSessionInDir(workingDir, excludeIds) {
  const candidates = listThreads({ includeArchived: true, includeSystem: false })
    .filter(thread => thread.cwd === workingDir && !excludeIds.has(thread.id))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return candidates[0]?.id || null;
}

function searchSessions(query, includeArchived) {
  const q = (query || '').toLowerCase();
  const native = listThreads({ includeArchived: true, includeSystem: false })
    .filter(thread => includeArchived || !thread.archived)
    .map(thread => {
      const rollout = readRollout(thread);
      return { thread, rollout, session: normalizeThread(thread, null, rollout) };
    })
    .filter(({ thread, rollout, session }) => {
      const haystack = [
        session.title,
        thread.title,
        thread.cwd,
        thread.first_user_message,
        thread.preview,
        ...rollout.messages.filter(m => m.role === 'user').map(m => m.text),
      ].filter(Boolean).join('\n').toLowerCase();
      return haystack.includes(q);
    })
    .map(({ session }) => session);
  return [...native, ...transcriptHeadless.searchSessions(query, includeArchived)]
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function latestPrompt() {
  const threads = listThreads({ includeArchived: true, includeSystem: false });
  const thread = threads.find(t => t.first_user_message || t.preview);
  const native = thread ? {
    sessionId: thread.id,
    title: thread.title || thread.id.slice(0, 8),
    project: projectName(thread.cwd),
    prompt: thread.first_user_message || thread.preview,
    timestamp: thread.updated_at,
  } : null;
  const external = transcriptHeadless.latestPrompt();
  if (!native) return external;
  if (!external) return native;
  return external.timestamp > native.timestamp ? external : native;
}

function stats(options = {}) {
  const requestedMode = options.statsMode || (
    options.includeTranscriptHeadless === '0' || options.includeTranscriptHeadless === 'false' || options.includeTranscriptHeadless === false
      ? 'codex'
      : 'combined'
  );
  const statsMode = ['combined', 'triage', 'codex'].includes(requestedMode) ? requestedMode : 'combined';
  const nativeThreadsAll = listThreads({ includeArchived: false, includeSystem: false });
  const threads = statsMode === 'triage' ? [] : nativeThreadsAll;
  const externalSessionsAll = transcriptHeadless.listSessions();
  const externalSessions = statsMode === 'codex' ? [] : externalSessionsAll;
  const fingerprint = [
    statsMode,
    ...nativeThreadsAll.map(thread => `${thread.id}:${thread.updated_at || 0}:${thread.tokens_used || 0}`),
    ...externalSessionsAll.map(session => `${session.id}:${session.lastActivityAt || 0}`),
  ].join('|');
  const cachedStats = statsResultCache.get(statsMode);
  if (cachedStats?.fingerprint === fingerprint) return cachedStats.value;
  const rollouts = new Map();
  const getRollout = thread => {
    if (!rollouts.has(thread.id)) rollouts.set(thread.id, readRollout(thread));
    return rollouts.get(thread.id);
  };

  const now = Math.floor(Date.now() / 1000);
  const byDay = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
    byDay[d] = 0;
  }
  for (const thread of threads) {
    const d = new Date((thread.created_at || 0) * 1000).toISOString().slice(0, 10);
    if (d in byDay) byDay[d]++;
  }
  for (const session of externalSessions) {
    const d = new Date((session.lastActivityAt || session.createdAt || 0) * 1000).toISOString().slice(0, 10);
    if (d in byDay) byDay[d]++;
  }

  const projectMap = {};
  for (const thread of threads) {
    const name = projectName(thread.cwd);
    const rollout = getRollout(thread);
    const durationSec = Math.max(0, (thread.updated_at || 0) - (thread.created_at || 0));
    const bucket = projectMap[name] ||= { name, sessions: 0, messages: 0, durationSec: 0, sessions_detail: [] };
    bucket.sessions++;
    bucket.messages += rollout.messages.length;
    bucket.durationSec += durationSec;
    bucket.sessions_detail.push({
      id: thread.id,
      title: thread.title || thread.id.slice(0, 8),
      durationSec,
      durationStr: formatDuration(durationSec),
      messages: rollout.messages.length,
    });
  }
  for (const session of externalSessions) {
    const preview = transcriptHeadless.getSessionPreview(session.id);
    const durationSec = preview?.durationSec || 0;
    const messages = (preview?.userMsgCount || 0) + (preview?.assistantMsgCount || 0);
    const bucket = projectMap['transcript-pipeline'] ||= { name: 'transcript-pipeline', sessions: 0, messages: 0, durationSec: 0, sessions_detail: [] };
    bucket.sessions++;
    bucket.messages += messages;
    bucket.durationSec += durationSec;
    bucket.sessions_detail.push({
      id: session.id,
      title: dashboardStore.getTitle(session.id) || session.title || session.id,
      durationSec,
      durationStr: formatDuration(durationSec),
      messages,
    });
  }
  const projects = Object.values(projectMap).map(p => ({ ...p, durationStr: formatDuration(p.durationSec) }));

  const toolInteractive = {};
  const toolHeadlessOther = {};
  const modelMap = {};
  const tokensByHour = emptyTokenWindows();
  const tokenHeatmap = emptyTokenHeatmap();
  const usageRecords = [];
  const recentPrompts = [];
  let latestRateLimits = null;
  let latestRateLimitAt = 0;

  for (const thread of nativeThreadsAll) {
    const rollout = getRollout(thread);
    const toolBucket = isNativeHeadlessThread(thread) ? toolHeadlessOther : toolInteractive;
    for (const tool of rollout.tools) toolBucket[tool.name] = (toolBucket[tool.name] || 0) + 1;
  }

  for (const thread of threads) {
    const rollout = getRollout(thread);
    const model = thread.model || 'codex';
    const reasoningEffort = thread.reasoning_effort || rollout.metadata.reasoning_effort || 'unknown';
    const modelKey = `${model}::${reasoningEffort}`;
    const tokens = tokenTelemetry(rollout, thread);
    if (tokens.rateLimits && (thread.updated_at || 0) >= latestRateLimitAt) {
      latestRateLimits = tokens.rateLimits;
      latestRateLimitAt = thread.updated_at || 0;
    }
    const modelEntry = modelMap[modelKey] ||= {
      key: modelKey,
      model,
      reasoningEffort,
      calls: 0,
      inputTokens: 0,
      totalInputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      visibleOutputTokens: 0,
      reasoningOutputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      unclassifiedTokens: 0,
      totalTokens: 0,
      sessions: 0,
    };
    modelEntry.inputTokens += tokens.inputTokens;
    modelEntry.totalInputTokens += tokens.totalInputTokens;
    modelEntry.cachedInputTokens += tokens.cachedInputTokens;
    modelEntry.outputTokens += tokens.outputTokens;
    modelEntry.visibleOutputTokens += tokens.visibleOutputTokens;
    modelEntry.reasoningOutputTokens += tokens.reasoningOutputTokens;
    modelEntry.cacheReadTokens += tokens.cacheReadTokens;
    modelEntry.cacheWriteTokens += tokens.cacheWriteTokens;
    modelEntry.unclassifiedTokens += tokens.unclassifiedTokens;
    modelEntry.totalTokens += tokens.totalTokens;
    modelEntry.sessions++;
    modelEntry.calls += tokens.calls || 1;
    usageRecords.push(...usageRecordsForThread(thread, rollout, tokens));
    for (const event of rollout.tokenEvents || []) {
      if (event.last) addTokenActivity(tokensByHour, tokenHeatmap, event.createdAt, normalizeTokenUsage(event.last));
    }
    if (!rollout.tokenEvents?.length && tokens.totalTokens) {
      addTokenActivity(tokensByHour, tokenHeatmap, thread.updated_at || thread.created_at || 0, tokens);
    }
    if (thread.first_user_message) {
      recentPrompts.push({
        sessionId: thread.id,
        title: thread.title || thread.id.slice(0, 8),
        project: projectName(thread.cwd),
        prompt: thread.first_user_message,
        timestamp: thread.updated_at,
      });
    }
  }

  const toolRank = counts => Object.entries(counts)
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 12);
  const transcriptHeadlessCounts = {};
  for (const session of externalSessionsAll) {
    const name = session.externalKind || 'transcript-pipeline';
    transcriptHeadlessCounts[name] = (transcriptHeadlessCounts[name] || 0) + 1;
  }
  const allHeadlessCounts = { ...toolHeadlessOther };
  for (const [name, calls] of Object.entries(transcriptHeadlessCounts)) {
    allHeadlessCounts[name] = (allHeadlessCounts[name] || 0) + calls;
  }

  const addModelUsage = (model, reasoningEffort, tokens) => {
    const modelKey = `${model}::${reasoningEffort || 'unknown'}`;
    const modelEntry = modelMap[modelKey] ||= {
      key: modelKey,
      model,
      reasoningEffort: reasoningEffort || 'unknown',
      calls: 0,
      inputTokens: 0,
      totalInputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      visibleOutputTokens: 0,
      reasoningOutputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      unclassifiedTokens: 0,
      totalTokens: 0,
      sessions: 0,
    };
    modelEntry.inputTokens += tokens.inputTokens || 0;
    modelEntry.totalInputTokens += tokens.totalInputTokens || 0;
    modelEntry.cachedInputTokens += tokens.cachedInputTokens || 0;
    modelEntry.outputTokens += tokens.outputTokens || 0;
    modelEntry.visibleOutputTokens += tokens.visibleOutputTokens || 0;
    modelEntry.reasoningOutputTokens += tokens.reasoningOutputTokens || 0;
    modelEntry.cacheReadTokens += tokens.cacheReadTokens || 0;
    modelEntry.cacheWriteTokens += tokens.cacheWriteTokens || 0;
    modelEntry.unclassifiedTokens += tokens.unclassifiedTokens || 0;
    modelEntry.totalTokens += tokens.totalTokens || 0;
    modelEntry.sessions++;
    modelEntry.calls += tokens.calls || 1;
  };

  const sessionMap = Object.fromEntries(threads.map(thread => {
    const rollout = getRollout(thread);
    const tokens = tokenTelemetry(rollout, thread);
    return [thread.id, {
      id: thread.id,
      title: thread.title || thread.id.slice(0, 8),
      project: projectName(thread.cwd),
      model: thread.model || 'codex',
      reasoningEffort: thread.reasoning_effort || rollout.metadata.reasoning_effort || null,
      durationSec: Math.max(0, (thread.updated_at || 0) - (thread.created_at || 0)),
      userMsgCount: rollout.messages.filter(m => m.role === 'user').length,
      ...tokens,
    }];
  }));
  for (const session of externalSessions) {
    const preview = transcriptHeadless.getSessionPreview(session.id);
    if (!preview) continue;
    const tokens = {
      inputTokens: preview.inputTokens || 0,
      totalInputTokens: preview.totalInputTokens || 0,
      cachedInputTokens: preview.cachedInputTokens || 0,
      outputTokens: preview.outputTokens || 0,
      visibleOutputTokens: preview.visibleOutputTokens || 0,
      reasoningOutputTokens: preview.reasoningOutputTokens || 0,
      cacheReadTokens: preview.cacheReadTokens || 0,
      cacheWriteTokens: preview.cacheWriteTokens || 0,
      unclassifiedTokens: preview.unclassifiedTokens || 0,
      totalTokens: preview.totalTokens || 0,
      calls: preview.calls || 1,
    };
    if (preview.rateLimits && (session.lastActivityAt || 0) >= latestRateLimitAt) {
      latestRateLimits = preview.rateLimits;
      latestRateLimitAt = session.lastActivityAt || 0;
    }
    addModelUsage(session.model || 'codex', session.reasoningEffort || 'unknown', tokens);
    usageRecords.push({
      timestamp: session.lastActivityAt || session.createdAt || 0,
      usage: tokens,
      model: session.model || 'codex',
      reasoningEffort: session.reasoningEffort || 'unknown',
      project: session.project || 'transcript-pipeline',
      session: {
        id: session.id,
        title: dashboardStore.getTitle(session.id) || session.title || session.id,
        model: session.model || 'codex',
        reasoningEffort: session.reasoningEffort || 'unknown',
      },
    });
    if (tokens.totalTokens) addTokenActivity(tokensByHour, tokenHeatmap, session.lastActivityAt || session.createdAt || 0, tokens);
    if (session.firstUserPrompt) {
      recentPrompts.push({
        sessionId: session.id,
        title: dashboardStore.getTitle(session.id) || session.title || session.id,
        project: session.project || 'transcript-pipeline',
        prompt: session.firstUserPrompt,
        timestamp: session.lastActivityAt,
      });
    }
    sessionMap[session.id] = {
      id: session.id,
      title: dashboardStore.getTitle(session.id) || session.title || session.id,
      project: session.project || 'transcript-pipeline',
      model: session.model || 'codex',
      reasoningEffort: session.reasoningEffort || null,
      durationSec: preview.durationSec || 0,
      userMsgCount: preview.userMsgCount || 0,
      ...tokens,
    };
  }

  const result = {
    activity: {
      h24: threads.filter(t => now - t.updated_at < 86400).length + externalSessions.filter(s => now - s.lastActivityAt < 86400).length,
      h48: threads.filter(t => now - t.updated_at < 172800).length + externalSessions.filter(s => now - s.lastActivityAt < 172800).length,
      h72: threads.filter(t => now - t.updated_at < 259200).length + externalSessions.filter(s => now - s.lastActivityAt < 259200).length,
      older: threads.filter(t => now - t.updated_at >= 259200).length + externalSessions.filter(s => now - s.lastActivityAt >= 259200).length,
      total: threads.length + externalSessions.length,
    },
    sessionsByDay: byDay,
    projects: projects.sort((a, b) => b.messages - a.messages),
    tools: {
      interactive: toolRank(toolInteractive),
      headless: toolRank(allHeadlessCounts),
    },
    activityByHour: { b24: new Array(24).fill(0), b48: new Array(24).fill(0), b7d: [] },
    tokensByHour,
    tokenHeatmap,
    usageRollups: buildUsageRollups(usageRecords, now),
    pricing: pricingMetadata(),
    models: Object.values(modelMap).sort((a, b) => b.totalTokens - a.totalTokens),
    recentPrompts: recentPrompts.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    mcpServers: codexMcpServers(),
    skills: codexSkills(),
    plugins: codexPlugins(),
    codexVersion: codexVersion(),
    model: null,
    permissionMode: null,
    topSessionsByDuration: Object.values(sessionMap)
      .sort((a, b) => b.durationSec - a.durationSec)
      .slice(0, 10)
      .map(s => ({ ...s, durationStr: formatDuration(s.durationSec) })),
    topSessionsByUserMsgs: Object.values(sessionMap)
      .sort((a, b) => b.userMsgCount - a.userMsgCount)
      .slice(0, 10),
    topSessionsByTokens: Object.values(sessionMap)
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 10),
    totalSubagents: threads.reduce((sum, thread) => {
      const rollout = getRollout(thread);
      return sum + new Set(rollout.subagentEvents
        .filter(event => event.kind === 'started')
        .map(event => event.agent_thread_id)
        .filter(Boolean)).size;
    }, 0),
    rateLimits: latestRateLimits,
    sources: {
      ...sourceBreakdown(threads),
      ...(externalSessions.length ? { 'transcript-pipeline': externalSessions.length } : {}),
    },
    statsFilters: {
      statsMode,
      transcriptHeadlessCount: externalSessionsAll.length,
    },
  };
  statsResultCache.set(statsMode, { fingerprint, value: result });
  return result;
}

function sourceBreakdown(threads) {
  const counts = {};
  for (const thread of threads) counts[thread.source] = (counts[thread.source] || 0) + 1;
  return counts;
}

function codexVersion() {
  try {
    return execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

function codexMcpServers() {
  const configPath = path.join(resolveCodexHome(), 'config.toml');
  let raw = '';
  try { raw = fs.readFileSync(configPath, 'utf8'); } catch { return []; }
  const names = [];
  for (const match of raw.matchAll(/^\s*\[mcp_servers\.([^\]]+)\]/gm)) names.push(match[1].replace(/^"|"$/g, ''));
  return names.map(name => ({ name, type: 'codex', url: null }));
}

function codexSkills() {
  const dirs = [
    path.join(resolveCodexHome(), 'skills'),
    path.join(resolveCodexHome(), 'plugins', 'cache'),
  ];
  const result = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length && result.length < 100) {
      const current = stack.pop();
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
      if (entries.some(e => e.name === 'SKILL.md')) {
        result.push({ name: path.basename(current), description: current });
        continue;
      }
      for (const entry of entries) if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  return result;
}

function codexPlugins() {
  const dir = path.join(resolveCodexHome(), 'plugins', 'cache');
  if (!fs.existsSync(dir)) return [];
  const result = [];
  const stack = [dir];
  while (stack.length && result.length < 50) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    if (entries.some(e => e.name === '.codex-plugin')) {
      result.push({ name: path.basename(current), dir: current, description: current });
      continue;
    }
    for (const entry of entries) if (entry.isDirectory()) stack.push(path.join(current, entry.name));
  }
  return result;
}

module.exports = {
  listSessions,
  listArchivedSessions,
  getSession,
  getSessionPreview,
  getSessionConversation,
  getSessionContextBreakdown,
  getSessionConfig,
  renameSession,
  hideSession,
  restoreSession,
  listRepos,
  listSessionIds,
  findNewSessionInDir,
  searchSessions,
  latestPrompt,
  stats,
  formatDuration,
};

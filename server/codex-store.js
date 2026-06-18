/**
 * Codex session adapter.
 *
 * Reads Codex's local thread state and rollout JSONL history, then exposes the
 * dashboard's existing session-oriented API shape.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { resolveCodexHome, resolveStateDbPath, findRolloutPath } = require('./codex-paths');
const dashboardStore = require('./dashboard-store');

const USER_SOURCES = new Set(['cli', 'vscode']);
const DEFAULT_CONTEXT = 200000;

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
  return text ? { role, text, createdAt: null } : null;
}

function eventMessage(payload) {
  if (!payload?.message) return null;
  if (payload.type === 'user_message') return { role: 'user', text: payload.message, createdAt: null };
  if (payload.type === 'agent_message') return { role: 'assistant', text: payload.message, createdAt: null };
  return null;
}

function extractToolName(payload) {
  if (!payload) return null;
  return payload.name || payload.tool_name || payload.recipient_name || payload.tool || null;
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
    metadata: {},
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
      msg = eventMessage(event.payload || {});
      if (event.payload?.type && /error|failed|approval/i.test(event.payload.type)) {
        result.errors.push({ type: event.payload.type, createdAt, message: event.payload.message || '' });
      }
    }

    if (msg?.text) {
      msg.createdAt = createdAt;
      result.messages.push(msg);
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

function normalizeThread(thread, overrides = dashboardStore.titleOverrides(), rollout = null) {
  const parsed = rollout || readRollout(thread);
  const firstUser = thread.first_user_message || parsed.messages.find(m => m.role === 'user')?.text || null;
  const lastUser = [...parsed.messages].reverse().find(m => m.role === 'user')?.text || firstUser;
  const lastAssistant = [...parsed.messages].reverse().find(m => m.role === 'assistant')?.text || null;
  const title = overrides.get(thread.id) || thread.title || firstUser || thread.id.slice(0, 8);

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
    sandboxPolicy: thread.sandbox_policy || null,
    approvalMode: thread.approval_mode || null,
    memoryMode: thread.memory_mode || null,
    status: thread.archived ? 'archived' : statusFor(thread, parsed),
    snippet: thread.preview || lastAssistant || firstUser || null,
    firstUserPrompt: firstUser,
    lastUserPrompt: lastUser,
    hasSubagents: false,
    archived: !!thread.archived,
    lastActivityAt: thread.updated_at || thread.created_at || 0,
    lastActivityAgo: relativeTime(thread.updated_at || thread.created_at || 0),
    createdAt: thread.created_at || 0,
    gitBranch: thread.git_branch || null,
    gitSha: thread.git_sha || null,
  };
}

function listSessions() {
  const overrides = dashboardStore.titleOverrides();
  return listThreads({ includeArchived: false, includeSystem: false })
    .map(thread => normalizeThread(thread, overrides));
}

function listArchivedSessions() {
  const overrides = dashboardStore.titleOverrides();
  return listThreads({ includeArchived: true, includeSystem: false })
    .filter(thread => !!thread.archived)
    .map(thread => normalizeThread(thread, overrides));
}

function getSession(id) {
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

function getSessionPreview(id) {
  const thread = getThread(id, { includeArchived: true, includeSystem: false });
  if (!thread) return null;
  const rollout = readRollout(thread);
  const session = normalizeThread(thread, dashboardStore.titleOverrides(), rollout);
  const durationSec = Math.max(0, (thread.updated_at || 0) - (thread.created_at || 0));
  const inputTokens = 0;
  const outputTokens = tokenFromThread(thread);

  return {
    ...session,
    startingModel: session.model,
    currentModel: session.model,
    modelSwitches: [],
    permissionMode: thread.approval_mode || 'unknown',
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
    peakContextTokens: tokenFromThread(thread),
    topTools: topTools(rollout),
    subagentCount: 0,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: inputTokens + outputTokens,
    chatThread: rollout.turns.slice(-5),
    rolloutPath: rollout.path,
    sandboxPolicy: thread.sandbox_policy,
    approvalMode: thread.approval_mode,
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
  const totalUsed = Math.min(DEFAULT_CONTEXT, Math.max(tokenFromThread(thread), Math.ceil(totalChars / 4)));
  const categories = {};
  for (const [key, chars] of Object.entries(charCounts)) {
    categories[key] = totalChars > 0 ? Math.round((chars / totalChars) * totalUsed) : 0;
  }

  return {
    categories,
    totalUsed,
    maxContext: DEFAULT_CONTEXT,
    freeTokens: Math.max(0, DEFAULT_CONTEXT - totalUsed),
    compactionCount: rollout.events.filter(e => JSON.stringify(e).includes('compact')).length,
    model: thread.model || 'codex',
  };
}

function getSessionConfig(id) {
  const thread = getThread(id, { includeArchived: true, includeSystem: false });
  if (!thread) return null;
  const sandbox = thread.sandbox_policy ? safeJson(thread.sandbox_policy) : null;
  const permissions = [];
  if (thread.approval_mode) permissions.push({ scope: 'approval mode', action: thread.approval_mode });
  if (sandbox?.type) permissions.push({ scope: 'sandbox', action: sandbox.type });
  if (sandbox?.network) permissions.push({ scope: 'network', action: sandbox.network });

  return {
    rules: [],
    activeSkills: [],
    permissions,
    model: thread.model || null,
    permissionMode: thread.approval_mode || null,
  };
}

function safeJson(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function renameSession(id, title) {
  return dashboardStore.setTitle(id, title);
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
  runCodexCommand(['archive', id]);
  return { id, archived: true };
}

function restoreSession(id) {
  runCodexCommand(['unarchive', id]);
  return { id, archived: false };
}

function listRepos() {
  const seen = new Set();
  const repos = [];
  for (const thread of listThreads({ includeArchived: true, includeSystem: false })) {
    if (!thread.cwd || seen.has(thread.cwd)) continue;
    seen.add(thread.cwd);
    repos.push({ workingDir: thread.cwd, project: projectName(thread.cwd) });
  }
  return repos.sort((a, b) => a.project.localeCompare(b.project));
}

function listSessionIds() {
  return new Set(listThreads({ includeArchived: true, includeSystem: false }).map(thread => thread.id));
}

function findNewSessionInDir(workingDir, excludeIds) {
  const candidates = listThreads({ includeArchived: true, includeSystem: false })
    .filter(thread => thread.cwd === workingDir && !excludeIds.has(thread.id))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return candidates[0]?.id || null;
}

function searchSessions(query, includeArchived) {
  const q = (query || '').toLowerCase();
  const overrides = dashboardStore.titleOverrides();
  return listThreads({ includeArchived: true, includeSystem: false })
    .filter(thread => includeArchived || !thread.archived)
    .map(thread => {
      const rollout = readRollout(thread);
      return { thread, rollout, session: normalizeThread(thread, overrides, rollout) };
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
}

function latestPrompt() {
  const threads = listThreads({ includeArchived: true, includeSystem: false });
  const thread = threads.find(t => t.first_user_message || t.preview);
  if (!thread) return null;
  return {
    sessionId: thread.id,
    title: dashboardStore.getTitle(thread.id) || thread.title || thread.id.slice(0, 8),
    project: projectName(thread.cwd),
    prompt: thread.first_user_message || thread.preview,
    timestamp: thread.updated_at,
  };
}

function stats() {
  const threads = listThreads({ includeArchived: false, includeSystem: false });
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
      title: dashboardStore.getTitle(thread.id) || thread.title || thread.id.slice(0, 8),
      durationSec,
      durationStr: formatDuration(durationSec),
      messages: rollout.messages.length,
    });
  }
  const projects = Object.values(projectMap).map(p => ({ ...p, durationStr: formatDuration(p.durationSec) }));

  const toolInteractive = {};
  const modelMap = {};
  const tokensByHour = emptyTokenWindows();
  const tokenHeatmap = emptyTokenHeatmap();
  const recentPrompts = [];

  for (const thread of threads) {
    const rollout = getRollout(thread);
    for (const tool of rollout.tools) toolInteractive[tool.name] = (toolInteractive[tool.name] || 0) + 1;
    const model = thread.model || 'codex';
    const tokens = tokenFromThread(thread);
    const modelEntry = modelMap[model] ||= {
      model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      sessions: 0,
    };
    modelEntry.outputTokens += tokens;
    modelEntry.totalTokens += tokens;
    modelEntry.sessions++;
    modelEntry.calls++;
    addTokenActivity(tokensByHour, tokenHeatmap, thread.updated_at || thread.created_at || 0, tokens);
    if (thread.first_user_message) {
      recentPrompts.push({
        sessionId: thread.id,
        title: dashboardStore.getTitle(thread.id) || thread.title || thread.id.slice(0, 8),
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

  const sessionMap = Object.fromEntries(threads.map(thread => {
    const rollout = getRollout(thread);
    return [thread.id, {
      id: thread.id,
      title: dashboardStore.getTitle(thread.id) || thread.title || thread.id.slice(0, 8),
      project: projectName(thread.cwd),
      durationSec: Math.max(0, (thread.updated_at || 0) - (thread.created_at || 0)),
      userMsgCount: rollout.messages.filter(m => m.role === 'user').length,
      totalTokens: tokenFromThread(thread),
      outputTokens: tokenFromThread(thread),
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }];
  }));

  return {
    activity: {
      h24: threads.filter(t => now - t.updated_at < 86400).length,
      h48: threads.filter(t => now - t.updated_at < 172800).length,
      h72: threads.filter(t => now - t.updated_at < 259200).length,
      older: threads.filter(t => now - t.updated_at >= 259200).length,
      total: threads.length,
    },
    sessionsByDay: byDay,
    projects: projects.sort((a, b) => b.messages - a.messages),
    tools: { interactive: toolRank(toolInteractive), headless: [] },
    activityByHour: { b24: new Array(24).fill(0), b48: new Array(24).fill(0), b7d: [] },
    tokensByHour,
    tokenHeatmap,
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
    totalSubagents: 0,
    sources: sourceBreakdown(threads),
  };
}

function emptyTokenWindows() {
  const make = () => ({ input: new Array(24).fill(0), output: new Array(24).fill(0) });
  return { '1d': make(), '2d': make(), '7d': make(), '14d': make(), '30d': make(), all: make() };
}

function emptyTokenHeatmap() {
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      windows: { '1d': 0, '7d': 0, '14d': 0, '30d': 0 },
    }))
  );
}

function addTokenActivity(tokensByHour, heatmap, epochSec, tokens) {
  if (!epochSec || !tokens) return;
  const now = Math.floor(Date.now() / 1000);
  const age = now - epochSec;
  const date = new Date(epochSec * 1000);
  const hour = date.getHours();
  const day = (date.getDay() + 6) % 7; // Monday = 0
  const windows = [
    ['1d', 86400],
    ['2d', 172800],
    ['7d', 604800],
    ['14d', 1209600],
    ['30d', 2592000],
  ];
  for (const [key, seconds] of windows) {
    if (age <= seconds) {
      tokensByHour[key].output[hour] += tokens;
      heatmap[day][hour].windows[key === '2d' ? '1d' : key] =
        (heatmap[day][hour].windows[key === '2d' ? '1d' : key] || 0) + tokens;
    }
  }
  tokensByHour.all.output[hour] += tokens;
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

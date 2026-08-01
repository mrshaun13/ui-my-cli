'use strict';

const FIXTURE_MODE = 'isolated-playwright';
const WINDOWS = ['1d', '2d', '7d', '14d', '30d', 'all'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSessions(providerId, providerLabel) {
  // Server timestamps are epoch seconds. A fixed future instant keeps the
  // fixture deterministic while ensuring the cold-session filter shows it.
  const timestamp = 2_000_000_000;
  return [
    {
      id: `synthetic-${providerId}-1`,
      provider: providerId,
      title: `${providerLabel} synthetic question`,
      workingDir: '/synthetic/alpha',
      project: 'alpha',
      model: providerId === 'codex' ? 'gpt-5' : 'devin-synthetic',
      status: 'question',
      snippet: 'Synthetic session waiting for input',
      firstUserPrompt: 'Verify the isolated dashboard.',
      lastUserPrompt: 'Verify the isolated dashboard.',
      lastActivityAt: timestamp,
      lastActivityAgo: '1m ago',
      createdAt: timestamp - 600,
    },
    {
      id: `synthetic-${providerId}-2`,
      provider: providerId,
      title: `${providerLabel} synthetic finished`,
      workingDir: '/synthetic/beta',
      project: 'beta',
      model: providerId === 'codex' ? 'gpt-5-mini' : 'devin-synthetic',
      status: 'finished',
      snippet: 'Synthetic session completed',
      firstUserPrompt: 'Exercise tab persistence.',
      lastUserPrompt: 'Exercise tab persistence.',
      lastActivityAt: timestamp - 60,
      lastActivityAgo: '2m ago',
      createdAt: timestamp - 1200,
    },
  ];
}

function zeroHours() {
  return Array.from({ length: 24 }, () => 0);
}

function makeStats() {
  const tokensByHour = Object.fromEntries(WINDOWS.map(window => [
    window,
    { input: zeroHours(), output: zeroHours() },
  ]));
  const tokenHeatmap = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      windows: { '1d': 0, '2d': 0, '7d': 0, '14d': 0, '30d': 0, all: 0 },
    })));
  const usageRollups = Object.fromEntries(WINDOWS.map(window => [
    window,
    {
      label: window === 'all' ? 'all time' : `last ${window}`,
      totals: { totalTokens: 190, pricingCoverage: 1 },
      models: [],
      projects: [],
      sessions: [],
    },
  ]));
  return {
    projects: [{ name: 'alpha', durationSec: 600, messages: 2, sessions: 1, sessions_detail: [] }],
    tools: { interactive: [{ name: 'read', calls: 2 }], headless: [] },
    tokensByHour,
    tokenHeatmap,
    models: [{
      key: 'gpt-5::high',
      model: 'gpt-5',
      reasoningEffort: 'high',
      inputTokens: 100,
      cachedInputTokens: 40,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
      totalInputTokens: 140,
      visibleOutputTokens: 40,
      reasoningOutputTokens: 10,
      outputTokens: 50,
      totalTokens: 190,
      unclassifiedTokens: 0,
      calls: 2,
    }],
    totalSubagents: 0,
    topSessionsByDuration: [],
    topSessionsByUserMsgs: [],
    topSessionsByTokens: [],
    usageRollups,
    pricing: { source: 'https://developers.openai.com/codex/pricing' },
    statsFilters: { transcriptHeadlessCount: 0 },
    mcpServers: [],
    skills: [],
    plugins: [],
  };
}

function makeProvider(metadata) {
  let sessions = makeSessions(metadata.id, metadata.label);
  let archived = [];
  const stats = makeStats();

  const getSession = id => sessions.find(session => session.id === id)
    || archived.find(session => session.id === id)
    || null;

  return {
    ...metadata,
    availability: () => ({ available: true, synthetic: true }),
    stats: () => clone(stats),
    latestPrompt: () => ({
      sessionId: sessions[0].id,
      content: sessions[0].lastUserPrompt,
      timestamp: sessions[0].lastActivityAt,
    }),
    listSessions: () => clone(sessions),
    listArchivedSessions: () => clone(archived),
    searchSessions: query => clone([...sessions, ...archived].filter(session => {
      const haystack = `${session.title} ${session.project} ${session.snippet}`.toLowerCase();
      return haystack.includes(String(query).toLowerCase());
    })),
    listRepos: () => [
      { workingDir: '/synthetic/alpha', project: 'alpha' },
      { workingDir: '/synthetic/beta', project: 'beta' },
    ],
    listSessionIds: () => sessions.map(session => session.id),
    findNewSessionInDir: () => null,
    getSession: id => clone(getSession(id)),
    getSessionPreview: id => {
      const session = getSession(id);
      if (!session) return null;
      return {
        ...clone(session),
        archived: archived.some(item => item.id === id),
        assistantMsgCount: 1,
        backendType: 'synthetic',
        cacheReadTokens: 40,
        cacheWriteTokens: 0,
        compactionCount: 0,
        createdAtStr: 'synthetic start',
        currentModel: session.model,
        durationStr: '10m',
        inputTokens: 100,
        modelContextWindow: 200000,
        modelSwitches: [],
        outputTokens: 50,
        peakContextTokens: 1000,
        permissionMode: 'isolated read-only fixture',
        projectDurationStr: '10m',
        reasoningEffort: 'high',
        reasoningOutputTokens: 10,
        startingModel: session.model,
        subagentCount: 0,
        toolCallCount: 2,
        topTools: [{ name: 'read', calls: 2 }],
        totalNodes: 3,
        unclassifiedTokens: 0,
        userMsgCount: 1,
      };
    },
    getSessionConversation: id => getSession(id) ? {
      turns: [{
        createdAt: 2_000_000_000,
        assistantCreatedAt: 2_000_000_001,
        userText: 'Synthetic user message',
        assistantText: 'Synthetic assistant response',
      }],
      totalTurns: 1,
    } : null,
    getSessionContextBreakdown: id => getSession(id) ? {
      categories: {
        systemPrompt: 100,
        userMessages: 200,
        assistantMessages: 300,
        toolCalls: 100,
        toolResults: 300,
      },
      totalUsed: 1000,
      maxContext: 200000,
      freeTokens: 199000,
    } : null,
    getSessionConfig: id => getSession(id) ? {
      rules: [],
      activeSkills: [],
      permissions: [],
    } : null,
    renameSession: (id, title) => {
      const session = getSession(id);
      if (!session) throw new Error('Session not found');
      session.title = title || session.title;
      return clone(session);
    },
    hideSession: id => {
      const index = sessions.findIndex(session => session.id === id);
      if (index === -1) throw new Error('Session not found');
      archived.push(...sessions.splice(index, 1));
    },
    restoreSession: id => {
      const index = archived.findIndex(session => session.id === id);
      if (index === -1) throw new Error('Session not found');
      sessions.push(...archived.splice(index, 1));
    },
    subagents: { extractSubagents: () => [] },
    watchPaths: () => {
      throw new Error('Synthetic provider filesystem watches are disabled');
    },
  };
}

function createSyntheticRuntime() {
  const guard = globalThis.__UI_MY_CLI_ISOLATION_GUARD__ || {
    blockedLoads: 0,
    filesystemWatches: 0,
    processSpawns: 0,
    realStateReads: 0,
  };
  const providers = new Map([
    ['codex', makeProvider({
      id: 'codex', label: 'Codex', noun: 'session', dashboardTitle: 'Codex Dashboard',
      command: 'codex', accent: '#16c784', storagePrefix: 'codex',
    })],
    ['devin', makeProvider({
      id: 'devin', label: 'Devin', noun: 'session', dashboardTitle: 'Devin Dashboard',
      command: 'devin', accent: '#8b5cf6', storagePrefix: 'devin',
    })],
  ]);
  const terminals = new Map();
  let syntheticTerminalConnections = 0;
  let syntheticTerminalFrames = 0;

  const keyFor = (providerId, sessionId) => `${providerId}:${sessionId}`;
  const metadataFor = provider => ({
    id: provider.id,
    label: provider.label,
    noun: provider.noun,
    dashboardTitle: provider.dashboardTitle,
    command: provider.command,
    accent: provider.accent,
    storagePrefix: provider.storagePrefix,
    ...provider.availability(),
  });

  const codexAppServer = {
    listModels: async () => [],
    startAdaptiveTurn: async () => {
      guard.processSpawns += 1;
      throw new Error('Synthetic runtime forbids Codex app-server startup');
    },
    submitAdaptiveTurn: async () => {
      guard.processSpawns += 1;
      throw new Error('Synthetic runtime forbids Codex app-server startup');
    },
    stop() {},
  };

  return {
    DEFAULT_PROVIDER_ID: 'codex',
    getProvider(id = 'codex') {
      const provider = providers.get(id);
      if (!provider) throw new Error(`Unknown synthetic provider: ${id}`);
      return provider;
    },
    safeListProviders: () => [...providers.values()].map(metadataFor),
    attachClient(providerId, sessionId, _workingDir, ws) {
      const key = keyFor(providerId, sessionId);
      if (!terminals.has(key)) terminals.set(key, new Set());
      terminals.get(key).add(ws);
      syntheticTerminalConnections += 1;
      ws.send(JSON.stringify({
        type: 'output',
        data: `\u001b[2J\u001b[H${providerId} Synthetic terminal — no process attached\r\n$ `,
      }));
      ws.on('message', raw => {
        syntheticTerminalFrames += 1;
        try {
          const message = JSON.parse(String(raw));
          if (message.type === 'input') {
            ws.send(JSON.stringify({ type: 'output', data: '[synthetic input ignored]\r\n' }));
          }
        } catch {
          // Ignore non-JSON frames; nothing is executed.
        }
      });
      ws.on('close', () => terminals.get(key)?.delete(ws));
    },
    killPty(providerId, sessionId) {
      const key = keyFor(providerId, sessionId);
      const clients = terminals.get(key);
      if (!clients) return false;
      for (const client of clients) {
        try { client.close(1000, 'Synthetic terminal closed'); } catch { /* ignore */ }
      }
      terminals.delete(key);
      return true;
    },
    isPtyActive: (providerId, sessionId) => terminals.has(keyFor(providerId, sessionId)),
    isPtyControlPlane: () => false,
    activePtySessions(providerId) {
      return [...terminals.keys()]
        .map(key => {
          const split = key.indexOf(':');
          return { providerId: key.slice(0, split), sessionId: key.slice(split + 1) };
        })
        .filter(entry => !providerId || entry.providerId === providerId);
    },
    spawnNewSession() {
      guard.processSpawns += 1;
      throw new Error('Synthetic runtime forbids provider process spawning');
    },
    rekeyPty(providerId, oldId, newId) {
      const oldKey = keyFor(providerId, oldId);
      if (!terminals.has(oldKey)) return false;
      terminals.set(keyFor(providerId, newId), terminals.get(oldKey));
      terminals.delete(oldKey);
      return true;
    },
    validatePty() {
      guard.processSpawns += 1;
      throw new Error('Synthetic runtime forbids PTY validation');
    },
    isTrustedLaunchRequest: () => true,
    async launchNativeDashboard() {
      guard.processSpawns += 1;
      throw new Error('Synthetic runtime forbids native launch');
    },
    nativeLaunchCapability: () => ({ available: false, reason: 'disabled by isolated fixture' }),
    wantsCodexControlPlane: () => false,
    tryStartCodexControlPlane: async () => null,
    trackPendingSession() {
      guard.processSpawns += 1;
      throw new Error('Synthetic runtime forbids pending provider sessions');
    },
    codexAppServer,
    statusMetadata: () => ({
      fixtureMode: FIXTURE_MODE,
      syntheticSessionIds: [...providers.values()].flatMap(provider =>
        provider.listSessions().map(session => session.id)),
      isolation: clone(guard),
      syntheticTerminalConnections,
      syntheticTerminalFrames,
    }),
  };
}

module.exports = { FIXTURE_MODE, createSyntheticRuntime };

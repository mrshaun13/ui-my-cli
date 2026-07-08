/**
 * Agent Dashboard — Express server with WebSocket support.
 *
 * REST endpoints:
 *   GET  /api/sessions              — list all sessions with status
 *   GET  /api/sessions/:id          — single session detail
 *   POST /api/sessions/:id/rename   — update title (body: { title })
 *   POST /api/sessions/:id/kill-pty — kill the active PTY (not the session)
 *   GET  /api/status                — server health + active PTY count
 *
 * WebSocket:
 *   ws://localhost:PORT/ws/terminal/:id   — attach to PTY for session
 *   ws://localhost:PORT/ws/status         — server-push status updates every 3s
 *
 * Static:
 *   In production (npm start), serves the Vite build from client/dist.
 *   In dev (npm run dev), client is served by Vite's own dev server.
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const { attachClient, killPty, isPtyActive, activePtySessions, spawnNewSession, rekeyPty, validatePty } = require('./pty-manager');
const { DEFAULT_PROVIDER_ID, getProvider, safeListProviders } = require('./providers');

const PORT = parseInt(process.env.PORT || '7575', 10);
const IS_DEV = process.env.NODE_ENV !== 'production';
const CLIENT_DIST = path.resolve(__dirname, '..', 'client', 'dist');

// Server-side map of pending temp keys → real session UUIDs.
// Populated when the background rekey poll detects the real ID.
// Used by the DELETE handler so archiving a pending session targets the right ID.
const pendingToReal = new Map();

const app = express();
const server = http.createServer(app);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

// In dev, allow any localhost Vite port (5173, 5174, etc.); in prod, same-origin only
app.use(cors({
  origin: IS_DEV
    ? (origin, cb) => cb(null, !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    : false,
  methods: ['GET', 'POST'],
}));

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    defaultProvider: DEFAULT_PROVIDER_ID,
    providers: safeListProviders(),
    activePtys: activePtySessions().length,
    uptime: Math.floor(process.uptime()),
  });
});

app.get('/api/providers', (_req, res) => {
  res.json(safeListProviders());
});

app.get(['/api/:providerId/terminals', '/api/terminals'], providerRoute((provider, _req, res) => {
  res.json(activePtySessions(provider.id));
}));

function providerFromReq(req) {
  return getProvider(req.params.providerId || DEFAULT_PROVIDER_ID);
}

function providerRoute(handler) {
  return (req, res) => {
    let provider;
    try {
      provider = providerFromReq(req);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }
    return handler(provider, req, res);
  };
}

function pendingKey(providerId, tempKey) {
  return `${providerId}:${tempKey}`;
}

app.get(['/api/:providerId/stats', '/api/stats'], providerRoute((provider, req, res) => {
  try {
    res.json(provider.stats(req.query || {}));
  } catch (err) {
    console.error(`[${provider.id}:stats] error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/latest-prompt', '/api/latest-prompt'], providerRoute((provider, _req, res) => {
  try {
    res.json(provider.latestPrompt() || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/sessions', '/api/sessions'], providerRoute((provider, _req, res) => {
  try {
    res.json(provider.listSessions());
  } catch (err) {
    console.error(`[${provider.id}:sessions] list error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

// NOTE: /archived and /preview/:id must come before /:id so Express doesn't
// swallow literal strings as a session ID parameter.
app.get(['/api/:providerId/sessions/archived', '/api/sessions/archived'], providerRoute((provider, _req, res) => {
  try {
    res.json(provider.listArchivedSessions());
  } catch (err) {
    console.error(`[${provider.id}:sessions] archived list error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/sessions/search', '/api/sessions/search'], providerRoute((provider, req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const includeArchived = req.query.archived === '1';
  try {
    res.json(provider.searchSessions(q, includeArchived));
  } catch (err) {
    console.error(`[${provider.id}:sessions] search error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/repos', '/api/repos'], providerRoute((provider, _req, res) => {
  try {
    res.json(provider.listRepos());
  } catch (err) {
    console.error(`[${provider.id}:repos] list error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.post(['/api/:providerId/sessions/create', '/api/sessions/create'], providerRoute((provider, req, res) => {
  const { workingDir } = req.body;
  if (!workingDir || typeof workingDir !== 'string') {
    return res.status(400).json({ error: 'workingDir is required' });
  }
  if (!fs.existsSync(workingDir)) {
    return res.status(400).json({ error: 'workingDir does not exist on disk' });
  }

  try {
    // Snapshot current session IDs so the background re-key poller can detect the new one
    const before = provider.listSessionIds();
    const tempKey = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    spawnNewSession(provider.id, tempKey, workingDir);
    console.log(`[${provider.id}:create] spawned new session in ${workingDir} (key: ${tempKey})`);

    // Return immediately — the client connects its terminal to the temp key.
    // Codex writes a thread record after the interactive session starts, so we
    // poll in the background to re-key the PTY entry once the real session ID
    // appears. This prevents a duplicate PTY from being spawned if the user
    // clicks the sidebar card for the new session.
    const POLL_INTERVAL = 2000;
    const MAX_POLLS = 90;  // ~3 minutes of polling
    let polls = 0;

    const bgPoll = setInterval(() => {
      polls++;
      const realId = provider.findNewSessionInDir(workingDir, before);
      if (realId) {
        clearInterval(bgPoll);
        pendingToReal.set(pendingKey(provider.id, tempKey), realId);
        if (rekeyPty(provider.id, tempKey, realId)) {
          console.log(`[${provider.id}:create] re-keyed ${tempKey.slice(0, 20)}… → ${realId.slice(0, 8)}…`);
        }
        broadcastRekey(provider.id, tempKey, realId);
        broadcastSessions(provider.id);
      } else if (polls >= MAX_POLLS) {
        clearInterval(bgPoll);
        console.warn(`[${provider.id}:create] gave up re-keying ${tempKey.slice(0, 20)}… after ${MAX_POLLS} polls`);
        // Kill the orphaned PTY — it will never get a real session ID
        killPty(provider.id, tempKey);
        // Notify clients so they can clean up the pending tab/card
        broadcastPendingExpired(provider.id, tempKey);
      }
    }, POLL_INTERVAL);

    res.json({ tempKey });
  } catch (err) {
    console.error(`[${provider.id}:create] error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/sessions/:id/preview', '/api/sessions/:id/preview'], providerRoute((provider, req, res) => {
  try {
    const preview = provider.getSessionPreview(req.params.id);
    if (!preview) return res.status(404).json({ error: 'Session not found' });
    res.json(preview);
  } catch (err) {
    console.error(`[${provider.id}:sessions] preview error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/sessions/:id/conversation', '/api/sessions/:id/conversation'], providerRoute((provider, req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
    const limit  = Math.max(0, parseInt(req.query.limit  || '50', 10) || 0);
    const result = provider.getSessionConversation(req.params.id, offset, limit);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (err) {
    console.error(`[${provider.id}:sessions] conversation error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/sessions/:id/subagents', '/api/sessions/:id/subagents'], providerRoute((provider, req, res) => {
  try {
    const session = provider.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const subagents = provider.subagents.extractSubagents(req.params.id);
    res.json(subagents);
  } catch (err) {
    console.error(`[${provider.id}:sessions] subagents error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/sessions/:id/context', '/api/sessions/:id/context'], providerRoute((provider, req, res) => {
  try {
    const result = provider.getSessionContextBreakdown(req.params.id);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (err) {
    console.error(`[${provider.id}:sessions] context error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/sessions/:id/config', '/api/sessions/:id/config'], providerRoute((provider, req, res) => {
  try {
    const result = provider.getSessionConfig(req.params.id);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (err) {
    console.error(`[${provider.id}:sessions] config error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));

app.get(['/api/:providerId/sessions/:id', '/api/sessions/:id'], providerRoute((provider, req, res) => {
  try {
    const session = provider.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ ...session, ptyActive: isPtyActive(provider.id, req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.post(['/api/:providerId/sessions/:id/rename', '/api/sessions/:id/rename'], providerRoute((provider, req, res) => {
  try {
    const { title } = req.body;
    if (typeof title !== 'string' && title !== null) {
      return res.status(400).json({ error: 'title must be a string or null' });
    }
    const result = provider.renameSession(req.params.id, title);
    // Push updated session list immediately to all status feed clients
    broadcastSessions(provider.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.post(['/api/:providerId/sessions/:id/kill-pty', '/api/sessions/:id/kill-pty'], providerRoute((provider, req, res) => {
  const killed = killPty(provider.id, req.params.id);
  res.json({ killed });
}));

app.delete(['/api/:providerId/sessions/:id', '/api/sessions/:id'], providerRoute((provider, req, res) => {
  try {
    const reqId = req.params.id;
    // Resolve pending temp keys to real session UUIDs so both killPty and
    // hideSession target the correct entry after a rekey.
    const realId = reqId.startsWith('pending-') ? (pendingToReal.get(pendingKey(provider.id, reqId)) || reqId) : reqId;
    // Kill PTY under both keys — the entry may be under either depending on
    // whether the rekey has fired yet.
    killPty(provider.id, realId);
    if (realId !== reqId) killPty(provider.id, reqId);
    provider.hideSession(realId);
    // Clean up the server-side rekey map entry
    if (reqId.startsWith('pending-')) pendingToReal.delete(pendingKey(provider.id, reqId));
    broadcastSessions(provider.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.post(['/api/:providerId/sessions/:id/restore', '/api/sessions/:id/restore'], providerRoute((provider, req, res) => {
  try {
    provider.restoreSession(req.params.id);
    broadcastSessions(provider.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// ─── Static (production) ──────────────────────────────────────────────────────

if (!IS_DEV) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: undefined, maxPayload: 1 * 1024 * 1024 });

// Track active status-feed clients by provider so mutations never leak between
// Codex and Devin dashboards.
const statusClients = new Map();

function clientsFor(providerId) {
  if (!statusClients.has(providerId)) statusClients.set(providerId, new Set());
  return statusClients.get(providerId);
}

function broadcastSessions(providerId) {
  const clients = clientsFor(providerId);
  if (clients.size === 0) return;
  let payload;
  try {
    const provider = getProvider(providerId);
    payload = JSON.stringify({ type: 'sessions', data: provider.listSessions() });
  } catch (err) {
    console.error(`[${providerId}:broadcast] sessions error:`, err.message);
    return;
  }
  for (const client of clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

/**
 * Notify all status-feed clients that a pending session has been re-keyed
 * to a real session ID. The client uses this to swap its selectedId so the
 * sidebar highlights the correct card and the Terminal remounts cleanly.
 *
 * Message shape: { type: 'rekey', tempKey: string, realId: string }
 */
function broadcastRekey(providerId, tempKey, realId) {
  const clients = clientsFor(providerId);
  if (clients.size === 0) return;
  const payload = JSON.stringify({ type: 'rekey', tempKey, realId });
  for (const client of clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

/**
 * Notify all status-feed clients that a pending session's rekey poll expired
 * without finding a real session ID.  The client uses this to dismiss the
 * orphaned pending tab/card and show a "session failed to start" message.
 *
 * Message shape: { type: 'pending-expired', tempKey: string }
 */
function broadcastPendingExpired(providerId, tempKey) {
  const clients = clientsFor(providerId);
  if (clients.size === 0) return;
  const payload = JSON.stringify({ type: 'pending-expired', tempKey });
  for (const client of clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastLatestPrompt(providerId) {
  const clients = clientsFor(providerId);
  if (clients.size === 0) return;
  let payload;
  try {
    const provider = getProvider(providerId);
    const p = provider.latestPrompt();
    if (!p) return;
    payload = JSON.stringify({ type: 'latest-prompt', data: p });
  } catch (err) {
    console.error(`[${providerId}:broadcast] latest-prompt error:`, err.message);
    return;
  }
  for (const client of clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

// Watch provider local state files. Debounce 120ms to avoid duplicate events
// from SQLite WAL/SHM and rollout JSONL writes.
// Returns watcher references so they can be closed on shutdown.
function watchProvider(provider) {
  let debounceTimer = null;
  const watchers = [];
  function onDbChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      broadcastLatestPrompt(provider.id);
      broadcastSessions(provider.id);
    }, 120);
  }

  let paths = [];
  try {
    paths = provider.watchPaths ? provider.watchPaths() : [];
  } catch (err) {
    console.warn(`[${provider.id}:watch] disabled:`, err.message);
    return watchers;
  }

  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        watchers.push(fs.watch(p, onDbChange));
      } catch (e) {
        console.warn(`[${provider.id}:watch] could not watch ${p}:`, e.message);
      }
    }
  }
  return watchers;
}

wss.on('connection', (ws, req) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname || '';

  // Terminal PTY connection:
  //   /ws/:provider/terminal/:sessionId
  //   /ws/terminal/:sessionId  (default-provider compatibility alias)
  const termMatch = pathname.match(/^\/ws\/([^/]+)\/terminal\/([^/]+)$/);
  const legacyTermMatch = pathname.match(/^\/ws\/terminal\/([^/]+)$/);
  if (termMatch || legacyTermMatch) {
    const providerId = termMatch ? decodeURIComponent(termMatch[1]) : DEFAULT_PROVIDER_ID;
    let provider;
    try {
      provider = getProvider(providerId);
    } catch {
      ws.close(1008, 'Unknown provider');
      return;
    }
    const sessionId = decodeURIComponent(termMatch ? termMatch[2] : legacyTermMatch[1]);

    // Parse initial dimensions from query string
    const cols = parseInt(parsedUrl.searchParams.get('cols') || '80', 10);
    const rows = parseInt(parsedUrl.searchParams.get('rows') || '24', 10);

    // For pending sessions (from "New Session"), the PTY already exists in the
    // map under the temp key — attachClient will find it and attach the WS client.
    // For regular sessions, look up the working directory from the DB.
    const isPending = sessionId.startsWith('pending-');
    const session = isPending ? null : provider.getSession(sessionId);
    const workingDir = session?.workingDir || null;

    console.log(`[${provider.id}:pty] attaching to ${isPending ? 'pending' : 'session'} ${sessionId.slice(0, 20)}… (${cols}x${rows})`);
    attachClient(provider.id, sessionId, workingDir, ws, cols, rows);
    return;
  }

  // Status feed:
  //   /ws/:provider/status
  //   /ws/status  (default-provider compatibility alias)
  const statusMatch = pathname.match(/^\/ws\/([^/]+)\/status$/);
  if (statusMatch || pathname === '/ws/status') {
    const providerId = statusMatch ? decodeURIComponent(statusMatch[1]) : DEFAULT_PROVIDER_ID;
    let provider;
    try {
      provider = getProvider(providerId);
    } catch {
      ws.close(1008, 'Unknown provider');
      return;
    }
    const clients = clientsFor(provider.id);
    clients.add(ws);

    const push = () => {
      if (ws.readyState !== 1) return;
      try {
        ws.send(JSON.stringify({ type: 'sessions', data: provider.listSessions() }));
      } catch {
        // DB might be locked briefly; skip this tick
      }
    };

    push(); // Send immediately on connect
    const interval = setInterval(push, 3000);

    // Also send the latest prompt immediately so the client doesn't wait for
    // the next DB write event.
    try {
      const p = provider.latestPrompt();
      if (p && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'latest-prompt', data: p }));
      }
    } catch { /* ignore */ }

    const cleanup = () => {
      clearInterval(interval);
      clients.delete(ws);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
    return;
  }

  // Unknown path — close with protocol error
  ws.close(1002, 'Unknown WebSocket path');
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nAgent Dashboard running at http://localhost:${PORT}`);
  if (IS_DEV) {
    console.log(`Client dev server: http://localhost:5173`);
  }
  console.log(`Press Ctrl+C to stop.\n`);
  validatePty();
  const dbWatchers = safeListProviders().flatMap(info => {
    try {
      return watchProvider(getProvider(info.id));
    } catch {
      return [];
    }
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] ${signal} received — cleaning up…`);

    // Close fs.watch watchers
    for (const w of dbWatchers) {
      try { w.close(); } catch { /* ignore */ }
    }

    // Kill all PTY processes
    for (const entry of activePtySessions()) {
      try { killPty(entry.providerId, entry.sessionId); } catch { /* ignore */ }
    }

    // Close all WebSocket clients
    for (const clients of statusClients.values()) {
      for (const client of clients) {
        try { client.close(1001, 'Server shutting down'); } catch { /* ignore */ }
      }
      clients.clear();
    }
    statusClients.clear();

    // Close WebSocket server
    wss.close(() => {
      // Close HTTP server
      server.close(() => {
        console.log('[shutdown] clean exit');
        process.exit(0);
      });
    });

    // Force exit after 5s if graceful shutdown stalls
    setTimeout(() => {
      console.warn('[shutdown] forced exit after timeout');
      process.exit(1);
    }, 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error(`Set PORT=<number> to use a different port.\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

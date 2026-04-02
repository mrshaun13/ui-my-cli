/**
 * Devin Dashboard — Express server with WebSocket support.
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
const url = require('url');

const { listSessions, listArchivedSessions, getSession, getSessionPreview, getSessionConversation, getSessionContextBreakdown, getSessionConfig, renameSession, hideSession, restoreSession, listRepos, listSessionIds, findNewSessionInDir, searchSessions } = require('./sessions');
const { attachClient, killPty, isPtyActive, activePtySessions, spawnNewSession, rekeyPty, validatePty } = require('./pty-manager');
const { getStats, getLatestPrompt } = require('./stats');
const { extractSubagents } = require('./subagents');

const PORT = parseInt(process.env.PORT || '7575', 10);
const IS_DEV = process.env.NODE_ENV !== 'production';
const CLIENT_DIST = path.resolve(__dirname, '..', 'client', 'dist');

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
    activePtys: activePtySessions().length,
    uptime: Math.floor(process.uptime()),
  });
});

app.get('/api/stats', (_req, res) => {
  try {
    res.json(getStats());
  } catch (err) {
    console.error('[stats] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/latest-prompt', (_req, res) => {
  try {
    res.json(getLatestPrompt() || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions', (_req, res) => {
  try {
    res.json(listSessions());
  } catch (err) {
    console.error('[sessions] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// NOTE: /archived and /preview/:id must come before /:id so Express doesn't
// swallow literal strings as a session ID parameter.
app.get('/api/sessions/archived', (_req, res) => {
  try {
    res.json(listArchivedSessions());
  } catch (err) {
    console.error('[sessions] archived list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const includeArchived = req.query.archived === '1';
  try {
    res.json(searchSessions(q, includeArchived));
  } catch (err) {
    console.error('[sessions] search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/repos', (_req, res) => {
  try {
    res.json(listRepos());
  } catch (err) {
    console.error('[repos] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/create', (req, res) => {
  const { workingDir } = req.body;
  if (!workingDir || typeof workingDir !== 'string') {
    return res.status(400).json({ error: 'workingDir is required' });
  }
  if (!fs.existsSync(workingDir)) {
    return res.status(400).json({ error: 'workingDir does not exist on disk' });
  }

  try {
    // Snapshot current session IDs so the background re-key poller can detect the new one
    const before = listSessionIds();
    const tempKey = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    spawnNewSession(tempKey, workingDir);
    console.log(`[create] spawned new session in ${workingDir} (key: ${tempKey})`);

    // Return immediately — the client connects its terminal to the temp key.
    // The Devin CLI only writes a session record to SQLite after the user types
    // their first prompt, so we poll in the background to re-key the PTY entry
    // once the real session ID appears. This prevents a duplicate PTY from being
    // spawned if the user clicks the sidebar card for the new session.
    const POLL_INTERVAL = 2000;
    const MAX_POLLS = 90;  // ~3 minutes of polling
    let polls = 0;

    const bgPoll = setInterval(() => {
      polls++;
      const realId = findNewSessionInDir(workingDir, before);
      if (realId) {
        clearInterval(bgPoll);
        if (rekeyPty(tempKey, realId)) {
          console.log(`[create] re-keyed ${tempKey.slice(0, 20)}… → ${realId.slice(0, 8)}…`);
        }
        broadcastRekey(tempKey, realId);
        broadcastSessions();
      } else if (polls >= MAX_POLLS) {
        clearInterval(bgPoll);
        console.warn(`[create] gave up re-keying ${tempKey.slice(0, 20)}… after ${MAX_POLLS} polls`);
      }
    }, POLL_INTERVAL);

    res.json({ tempKey });
  } catch (err) {
    console.error('[create] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id/preview', (req, res) => {
  try {
    const preview = getSessionPreview(req.params.id);
    if (!preview) return res.status(404).json({ error: 'Session not found' });
    res.json(preview);
  } catch (err) {
    console.error('[sessions] preview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id/conversation', (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
    const limit  = Math.max(0, parseInt(req.query.limit  || '50', 10) || 0);
    const result = getSessionConversation(req.params.id, offset, limit);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (err) {
    console.error('[sessions] conversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id/subagents', (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const subagents = extractSubagents(req.params.id);
    res.json(subagents);
  } catch (err) {
    console.error('[sessions] subagents error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id/context', (req, res) => {
  try {
    const result = getSessionContextBreakdown(req.params.id);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (err) {
    console.error('[sessions] context error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id/config', (req, res) => {
  try {
    const result = getSessionConfig(req.params.id);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (err) {
    console.error('[sessions] config error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ ...session, ptyActive: isPtyActive(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/rename', (req, res) => {
  try {
    const { title } = req.body;
    if (typeof title !== 'string' && title !== null) {
      return res.status(400).json({ error: 'title must be a string or null' });
    }
    const result = renameSession(req.params.id, title);
    // Push updated session list immediately to all status feed clients
    broadcastSessions();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/kill-pty', (req, res) => {
  const killed = killPty(req.params.id);
  res.json({ killed });
});

app.delete('/api/sessions/:id', (req, res) => {
  try {
    // Kill any running PTY first so the process doesn't linger
    killPty(req.params.id);
    hideSession(req.params.id);  // "archive" in user-facing terms
    broadcastSessions();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/restore', (req, res) => {
  try {
    restoreSession(req.params.id);
    broadcastSessions();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Static (production) ──────────────────────────────────────────────────────

if (!IS_DEV) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: undefined });

// Track all active status feed clients so we can push to them immediately
// after mutations (rename, etc.) without waiting for the next 3s tick.
const statusClients = new Set();

function broadcastSessions() {
  if (statusClients.size === 0) return;
  let payload;
  try {
    payload = JSON.stringify({ type: 'sessions', data: listSessions() });
  } catch {
    return;
  }
  for (const client of statusClients) {
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
function broadcastRekey(tempKey, realId) {
  if (statusClients.size === 0) return;
  const payload = JSON.stringify({ type: 'rekey', tempKey, realId });
  for (const client of statusClients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastLatestPrompt() {
  if (statusClients.size === 0) return;
  let payload;
  try {
    const p = getLatestPrompt();
    if (!p) return;
    payload = JSON.stringify({ type: 'latest-prompt', data: p });
  } catch {
    return;
  }
  for (const client of statusClients) {
    if (client.readyState === 1) client.send(payload);
  }
}

// Watch the SQLite WAL file — the Devin CLI writes here every time a prompt
// is submitted. Debounce 120ms to avoid double-fires on WAL + SHM updates.
function watchDbForPrompts() {
  const { resolveDbPath } = require('./db-path');
  const dbPath = resolveDbPath();
  const walPath = dbPath + '-wal';

  // Watch both the main DB and WAL — depending on SQLite journal mode either
  // one may be the first file to change after a write.
  let debounceTimer = null;
  function onDbChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      broadcastLatestPrompt();
      broadcastSessions();
    }, 120);
  }

  for (const p of [dbPath, walPath]) {
    if (fs.existsSync(p)) {
      try {
        fs.watch(p, onDbChange);
      } catch (e) {
        console.warn(`[prompt-watch] could not watch ${p}:`, e.message);
      }
    }
  }
}

wss.on('connection', (ws, req) => {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname || '';

  // Terminal PTY connection: /ws/terminal/:sessionId
  const termMatch = pathname.match(/^\/ws\/terminal\/([^/]+)$/);
  if (termMatch) {
    const sessionId = termMatch[1];

    // Parse initial dimensions from query string
    const params = new URLSearchParams(parsedUrl.query || '');
    const cols = parseInt(params.get('cols') || '80', 10);
    const rows = parseInt(params.get('rows') || '24', 10);

    // For pending sessions (from "New Session"), the PTY already exists in the
    // map under the temp key — attachClient will find it and attach the WS client.
    // For regular sessions, look up the working directory from the DB.
    const isPending = sessionId.startsWith('pending-');
    const session = isPending ? null : getSession(sessionId);
    const workingDir = session?.workingDir || null;

    console.log(`[pty] attaching to ${isPending ? 'pending' : 'session'} ${sessionId.slice(0, 20)}… (${cols}x${rows})`);
    attachClient(sessionId, workingDir, ws, cols, rows);
    return;
  }

  // Status feed: /ws/status — pushes session list every 3s
  if (pathname === '/ws/status') {
    statusClients.add(ws);

    const push = () => {
      if (ws.readyState !== 1) return;
      try {
        ws.send(JSON.stringify({ type: 'sessions', data: listSessions() }));
      } catch {
        // DB might be locked briefly; skip this tick
      }
    };

    push(); // Send immediately on connect
    const interval = setInterval(push, 3000);

    // Also send the latest prompt immediately so the client doesn't wait for
    // the next DB write event.
    try {
      const p = getLatestPrompt();
      if (p && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'latest-prompt', data: p }));
      }
    } catch { /* ignore */ }

    const cleanup = () => {
      clearInterval(interval);
      statusClients.delete(ws);
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
  console.log(`\nDevin Dashboard running at http://localhost:${PORT}`);
  if (IS_DEV) {
    console.log(`Client dev server: http://localhost:5173`);
  }
  console.log(`Press Ctrl+C to stop.\n`);
  validatePty();
  watchDbForPrompts();
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

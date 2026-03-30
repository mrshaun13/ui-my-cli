/**
 * Devin Dashboard — Express server with WebSocket support.
 *
 * REST endpoints:
 *   GET  /api/sessions              — list all sessions with status
 *   GET  /api/sessions/:id          — single session detail
 *   POST /api/sessions/:id/rename   — update alias (body: { alias })
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

const { listSessions, listArchivedSessions, getSession, getSessionPreview, renameSession, hideSession, restoreSession } = require('./sessions');
const { attachClient, killPty, isPtyActive, activePtySessions } = require('./pty-manager');
const { getStats, getLatestPrompt } = require('./stats');

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
    const { alias } = req.body;
    if (typeof alias !== 'string' && alias !== null) {
      return res.status(400).json({ error: 'alias must be a string or null' });
    }
    const result = renameSession(req.params.id, alias);
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
    debounceTimer = setTimeout(broadcastLatestPrompt, 120);
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
    const cols = parseInt(params.get('cols') || '220', 10);
    const rows = parseInt(params.get('rows') || '50', 10);

    // Look up the session's working directory so the PTY starts there.
    // This prevents Devin from showing the workspace trust prompt.
    const session = getSession(sessionId);
    const workingDir = session?.workingDir || null;

    console.log(`[pty] attaching to session ${sessionId.slice(0, 8)}… (${cols}x${rows}) cwd=${workingDir || '~'}`);
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

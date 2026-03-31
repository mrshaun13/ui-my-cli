/**
 * PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients.
 *
 * One PTY per session ID. Multiple WS clients can attach to the same PTY
 * (e.g. two browser tabs), all sharing the same terminal stream.
 *
 * The PTY runs: devin --resume <session-id>
 *
 * On WSL: we need to ensure the shell environment is properly inherited
 * so the devin binary is on PATH.
 *
 * Output buffering:
 *   Each PTY keeps a rolling byte buffer (SCROLLBACK_BYTES) of recent output.
 *   New WebSocket clients receive the buffered output immediately on connect,
 *   so switching sessions and coming back shows the terminal in its last state
 *   rather than a blank screen.
 */

const os = require('os');
const fs = require('fs');
const { spawn } = require('node-pty');

// ~256 KB of scrollback replay per session — enough for a full screen + history
const SCROLLBACK_BYTES = 256 * 1024;

/**
 * Matches programmatic escape-sequence responses that xterm.js generates
 * in reply to terminal queries (OSC color reports, device attributes, etc.).
 * These should never reach the PTY — they are not user input.
 * The client already filters these, but we guard server-side too as defense
 * in depth so a misbehaving or older client can't pollute the PTY stream.
 */
const XTERM_RESPONSE_RE = new RegExp(
  '\\x1b\\](?:1[012]|4;\\d{1,3});rgb:[\\da-f]{4}/[\\da-f]{4}/[\\da-f]{4}(?:\\x1b\\\\|\\x07)' +
  '|\\x1b\\[\\?[\\d;]+c|\\x1b\\[>[\\d;]+c' +
  '|\\x1b\\[0n|\\x1b\\[\\??\\d+;\\d+R' +
  '|\\x1b\\[\\??\\d+;\\d+\\$y' +
  '|\\x1b\\[[468];\\d+;\\d+t' +
  '|\\x1b\\[[IO]' +
  '|\\x1bP[01]\\$r[^\\x1b]*\\x1b\\\\' +
  '|\\x1b\\[<\\d+;\\d+;\\d+[Mm]',
  'g'
);

/**
 * Strips OSC / DCS query sequences from PTY output so that replaying the
 * scrollback buffer into a fresh xterm instance doesn't re-trigger
 * programmatic responses (which would then flow back as phantom input).
 *
 * We strip the *queries* (e.g. \x1b]10;?\x07) rather than the responses,
 * because the queries are what cause xterm.js to generate the unwanted
 * response data via onData on the next connect.
 *
 * Matched query forms (BEL or ST terminated):
 *   OSC N ; ? BEL/ST        — e.g. \x1b]10;?\x07  (fg/bg/cursor color)
 *   OSC 4 ; N ; ? BEL/ST    — e.g. \x1b]4;1;?\x07 (indexed color)
 *   CSI c / CSI 0 c         — DA1 request
 *   CSI > c / CSI > 0 c     — DA2 request
 *   CSI 5 n / CSI 6 n       — DSR requests
 *   CSI ? 6 n               — DECDSR
 *   CSI Ps $ p / CSI ? Ps $ p — DECRQM
 *   CSI 14/16/18 t           — window-size queries
 *   DCS $ q ... ST           — DECRQSS
 */
const TERMINAL_QUERY_RE = new RegExp(
  // OSC color queries: \x1b]10;?\x07 or \x1b]10;?\x1b\\  (also 11, 12, 4;N)
  '\\x1b\\](?:1[012]|4;\\d{1,3});\\?(?:\\x07|\\x1b\\\\)' +
  // DA1/DA2 requests
  '|\\x1b\\[>?0?c' +
  // DSR: CSI 5n, CSI 6n, CSI ?6n
  '|\\x1b\\[\\??[56]n' +
  // DECRQM: CSI ?Ps$p or CSI Ps$p
  '|\\x1b\\[\\??\\d+\\$p' +
  // Window-size queries: CSI 14t, CSI 16t, CSI 18t
  '|\\x1b\\[1[468]t' +
  // DECRQSS: DCS $ q ... ST
  '|\\x1bP\\$q[^\\x1b]*(?:\\x1b\\\\|\\x07)',
  'g'
);

// Map of sessionId -> { pty, clients: Set<WebSocket>, scrollback: Buffer[] }
const ptys = new Map();

/**
 * Returns the shell to use for spawning the PTY.
 * Detects the user's preferred shell from SHELL env, falls back to /bin/bash.
 */
function getShell() {
  if (process.platform === 'win32') return 'cmd.exe';
  return process.env.SHELL || '/bin/bash';
}

/**
 * Returns the args to pass to the shell for launching devin.
 * If sessionId is provided, uses --resume; otherwise starts a new session.
 */
function getShellArgs(sessionId) {
  const cmd = sessionId
    ? `devin --resume ${sessionId} --respect-workspace-trust false`
    : `devin --respect-workspace-trust false`;
  if (process.platform === 'win32') {
    return ['/k', cmd];
  }
  return ['-i', '-l', '-c', cmd];
}

/**
 * Appends data to a session's scrollback ring buffer.
 * Keeps total stored bytes under SCROLLBACK_BYTES by dropping oldest chunks.
 */
function appendScrollback(entry, data) {
  entry.scrollback.push(data);
  entry.scrollbackSize += data.length;
  while (entry.scrollbackSize > SCROLLBACK_BYTES && entry.scrollback.length > 1) {
    const dropped = entry.scrollback.shift();
    entry.scrollbackSize -= dropped.length;
  }
}

/**
 * Sends all buffered scrollback to a single WebSocket client as one replay message.
 * We send it as output chunks (same protocol as live data) so the client handles
 * it identically to live output.
 *
 * Terminal query sequences (OSC 10;?, DA requests, etc.) are stripped before
 * replay so a fresh xterm instance doesn't re-answer them and generate
 * phantom input that pollutes the PTY stream.
 */
function replayScrollback(entry, ws) {
  if (!entry.scrollback.length) return;
  const combined = entry.scrollback.join('').replace(TERMINAL_QUERY_RE, '');
  if (combined.length === 0) return;
  if (ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify({ type: 'output', data: combined }));
  }
}

/**
 * Spawns a new PTY for the given session, or attaches to existing one.
 * workingDir: the session's working_directory from the DB — used as PTY cwd
 * so Devin doesn't show the workspace trust prompt.
 * ws: initial WebSocket client to attach.
 */
function spawnPty(sessionId, workingDir, ws, cols = 220, rows = 50) {
  if (ptys.has(sessionId)) {
    // Attach new client to existing PTY — replay scrollback so the terminal
    // isn't blank after a session switch.
    const entry = ptys.get(sessionId);
    replayScrollback(entry, ws);
    entry.clients.add(ws);
    // Resize the PTY to the new client's dimensions. This is critical for
    // pending sessions where the PTY was spawned with default dimensions
    // before any client connected. Without this, line wrapping and cursor
    // positioning are calculated for the wrong terminal size.
    try { entry.pty.resize(Math.max(1, cols), Math.max(1, rows)); } catch {}
    return entry.pty;
  }

  const shell = getShell();
  const args = getShellArgs(sessionId);

  // Use session's working directory so Devin doesn't prompt for workspace trust.
  // Fall back to home if the directory no longer exists (deleted repo, etc.).
  const cwd = (workingDir && fs.existsSync(workingDir)) ? workingDir : os.homedir();

  const pty = spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Prevent nested devin dashboard from launching
      DEVIN_DASHBOARD: '1',
    },
  });

  const entry = {
    pty,
    clients: new Set([ws]),
    scrollback: [],
    scrollbackSize: 0,
  };
  ptys.set(sessionId, entry);

  // Broadcast PTY output to all attached clients and accumulate scrollback
  pty.onData(data => {
    appendScrollback(entry, data);
    const dead = [];
    for (const client of entry.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(JSON.stringify({ type: 'output', data }));
      } else {
        dead.push(client);
      }
    }
    for (const c of dead) entry.clients.delete(c);
  });

  pty.onExit(({ exitCode }) => {
    // Notify all clients the process ended
    for (const client of entry.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'exit', exitCode }));
      }
    }
    ptys.delete(sessionId);
  });

  return pty;
}

/**
 * Attaches a WebSocket client to an existing PTY session.
 * If no PTY exists yet, spawns one in the session's working directory.
 */
function attachClient(sessionId, workingDir, ws, cols, rows) {
  const pty = spawnPty(sessionId, workingDir, ws, cols, rows);

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input') {
        // Strip any xterm.js programmatic responses that slipped through
        // the client-side filter (defense in depth).
        const cleaned = msg.data.replace(XTERM_RESPONSE_RE, '');
        if (cleaned) pty.write(cleaned);
      } else if (msg.type === 'resize') {
        pty.resize(
          Math.max(1, msg.cols || 80),
          Math.max(1, msg.rows || 24)
        );
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    const entry = ptys.get(sessionId);
    if (entry) entry.clients.delete(ws);
  });
}

/**
 * Kills the PTY for a given session and notifies all clients.
 */
function killPty(sessionId) {
  const entry = ptys.get(sessionId);
  if (!entry) return false;

  try {
    entry.pty.kill();
  } catch {
    // Already dead
  }
  ptys.delete(sessionId);
  return true;
}

/**
 * Returns whether a PTY is currently running for a session.
 */
function isPtyActive(sessionId) {
  return ptys.has(sessionId);
}

/**
 * Returns active PTY session IDs.
 */
function activePtySessions() {
  return [...ptys.keys()];
}

/**
 * Spawns a brand-new Devin session (no --resume) in the given working directory.
 * The PTY is stored under `tempKey` until the real session ID is detected from the
 * DB, at which point the caller should call rekeyPty(tempKey, realSessionId).
 *
 * No WebSocket client is attached initially — the client will connect via the
 * standard /ws/terminal/:sessionId path once the real ID is known.
 */
function spawnNewSession(tempKey, workingDir, cols = 220, rows = 50) {
  const shell = getShell();
  const args = getShellArgs(null);  // no sessionId → bare `devin`
  const cwd = (workingDir && fs.existsSync(workingDir)) ? workingDir : os.homedir();

  const pty = spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      DEVIN_DASHBOARD: '1',
    },
  });

  const entry = {
    pty,
    clients: new Set(),
    scrollback: [],
    scrollbackSize: 0,
  };
  ptys.set(tempKey, entry);

  pty.onData(data => {
    appendScrollback(entry, data);
    const dead = [];
    for (const client of entry.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'output', data }));
      } else {
        dead.push(client);
      }
    }
    for (const c of dead) entry.clients.delete(c);
  });

  pty.onExit(({ exitCode }) => {
    for (const client of entry.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'exit', exitCode }));
      }
    }
    // Clean up under whatever key we're stored as (might already be re-keyed)
    for (const [key, val] of ptys.entries()) {
      if (val === entry) { ptys.delete(key); break; }
    }
  });

  return entry;
}

/**
 * Re-keys a PTY entry in the map from oldKey to newKey.
 * This lets attachClient(realSessionId, ...) find the already-running PTY
 * instead of spawning a duplicate.
 */
function rekeyPty(oldKey, newKey) {
  const entry = ptys.get(oldKey);
  if (!entry) return false;
  ptys.delete(oldKey);
  ptys.set(newKey, entry);
  return true;
}

module.exports = { attachClient, killPty, isPtyActive, activePtySessions, spawnNewSession, rekeyPty };

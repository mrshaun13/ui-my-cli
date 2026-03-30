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
 * Returns the args to pass to the shell for launching devin --resume.
 * Using `-i -l` ensures we get an interactive login shell with full PATH loaded
 * (important on WSL/macOS where PATH is set in .bashrc/.zshrc).
 */
function getShellArgs(sessionId) {
  if (process.platform === 'win32') {
    return ['/k', `devin --resume ${sessionId} --respect-workspace-trust false`];
  }
  return ['-i', '-l', '-c', `devin --resume ${sessionId} --respect-workspace-trust false`];
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
 */
function replayScrollback(entry, ws) {
  if (!entry.scrollback.length) return;
  const combined = entry.scrollback.join('');
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
        pty.write(msg.data);
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

module.exports = { attachClient, killPty, isPtyActive, activePtySessions };

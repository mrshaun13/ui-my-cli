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
 */

const os = require('os');
const fs = require('fs');
const { spawn } = require('node-pty');

// Map of sessionId -> { pty, clients: Set<WebSocket> }
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
 * Spawns a new PTY for the given session, or returns the existing one.
 * workingDir: the session's working_directory from the DB — used as PTY cwd
 * so Devin doesn't show the workspace trust prompt.
 * ws: initial WebSocket client to attach.
 */
function spawnPty(sessionId, workingDir, ws, cols = 220, rows = 50) {
  if (ptys.has(sessionId)) {
    // Attach new client to existing PTY
    const entry = ptys.get(sessionId);
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

  const entry = { pty, clients: new Set([ws]) };
  ptys.set(sessionId, entry);

  // Broadcast PTY output to all attached clients
  pty.onData(data => {
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

/**
 * PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients, with Unix spawn-helper executable repair.
 *
 * One PTY per provider/session ID. Multiple WS clients can attach to the same PTY
 * (e.g. two browser tabs), all sharing the same terminal stream.
 *
 * The PTY runs the selected provider's resume command.
 *
 * On WSL: we need to ensure the shell environment is properly inherited
 * so the selected CLI binary is on PATH.
 *
 * On macOS and other Unix hosts, npm can ship node-pty's spawn-helper without the
 * executable bit; startup and spawn paths repair that mode so posix_spawnp works.
 *
 * Output buffering:
 *   Each PTY keeps a rolling byte buffer (SCROLLBACK_BYTES) of recent output.
 *   New WebSocket clients receive the buffered output immediately on connect,
 *   so switching sessions and coming back shows the terminal in its last state
 *   rather than a blank screen.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');
const { DEFAULT_PROVIDER_ID, getProvider } = require('./providers');

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

// Map of `${providerId}:${sessionId}` -> { pty, clients, scrollback, providerId, sessionId }
const ptys = new Map();
const ptyRemovedListeners = new Set();

function notifyPtyRemoved(entry) {
  if (!entry || entry.removalNotified) return;
  entry.removalNotified = true;
  for (const listener of ptyRemovedListeners) {
    try { listener(entry); } catch {}
  }
}

function onPtyRemoved(listener) {
  ptyRemovedListeners.add(listener);
  return () => ptyRemovedListeners.delete(listener);
}

// ── Shell resolution ────────────────────────────────────────────────────────

/**
 * Returns the shell to use for spawning the PTY.
 *
 * Cascade: $SHELL → /bin/zsh (macOS default) → /bin/bash → /bin/sh
 * Validates the binary exists before returning it so we never hand
 * node-pty a path that will cause posix_spawnp to fail.
 */
function getShell() {
  if (process.platform === 'win32') return 'cmd.exe';

  const candidates = [
    process.env.SHELL,
    process.platform === 'darwin' ? '/bin/zsh' : null,
    '/bin/bash',
    '/bin/sh',  // POSIX-guaranteed to exist
  ].filter(Boolean);

  for (const sh of candidates) {
    if (fs.existsSync(sh)) return sh;
  }

  // Should never reach here — /bin/sh must exist on any Unix
  return '/bin/sh';
}

/**
 * npm's node-pty prebuild archive currently ships its Unix spawn helper without
 * an executable mode on some macOS installations. The native module loads, but
 * every terminal then fails with the opaque "posix_spawnp failed" message.
 *
 * The helper is part of the locally installed dependency and needs no elevated
 * permission to repair. Do this at startup and immediately before a spawn so a
 * checkout copied from another machine or restored from an archive self-heals.
 */
function ensurePtySpawnHelperIsExecutable(options = {}) {
  try {
    const platform = options.platform ?? process.platform;
    if (platform === 'win32') return false;
    const arch = options.arch ?? process.arch;
    const nodePtyDirectory = options.nodePtyDirectory
      ?? path.dirname(require.resolve('node-pty/package.json'));
    const helper = path.join(nodePtyDirectory, 'prebuilds', `${platform}-${arch}`, 'spawn-helper');
    const existsSync = options.existsSync ?? fs.existsSync;
    const statSync = options.statSync ?? fs.statSync;
    const chmodSync = options.chmodSync ?? fs.chmodSync;
    if (!existsSync(helper)) return false;

    const mode = statSync(helper).mode;
    if ((mode & 0o111) !== 0) return false;
    chmodSync(helper, mode | 0o755);
    return true;
  } catch {
    return false;
  }
}

function ptyKey(providerId, sessionId) {
  return `${providerId || DEFAULT_PROVIDER_ID}:${sessionId}`;
}

/**
 * Build an interactive terminal environment independent of how the dashboard
 * process was launched. PM2/CI runners commonly export NO_COLOR or CODEX_CI;
 * passing those flags into a real PTY makes Codex deliberately render menus
 * without ANSI colors.
 */
function interactivePtyEnv(providerId, overrides = {}) {
  const env = { ...process.env };
  delete env.NO_COLOR;
  delete env.CODEX_CI;
  return {
    ...env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    UI_MY_CLI_DASHBOARD: '1',
    UI_MY_CLI_PROVIDER: providerId,
    // Strip Homebrew's npm_config_prefix so NVM loads cleanly in the PTY.
    // On macOS, Homebrew sets this to /opt/homebrew which makes NVM refuse
    // to start. Empty string effectively unsets it; harmless on Linux/WSL.
    npm_config_prefix: '',
    ...overrides,
  };
}

// ── Scrollback buffer ────────────────────────────────────────────────────────

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

// ── PTY lifecycle helpers ────────────────────────────────────────────────────

/** Sends a plain-text error to the terminal client (rendered as red text). */
function sendPtyError(ws, message) {
  if (ws.readyState !== 1) return;
  // CSI 31m = red foreground, CSI 0m = reset
  const redText = `\x1b[31m${message}\x1b[0m\r\n`;
  ws.send(JSON.stringify({ type: 'output', data: redText }));
}

/**
 * Wires up PTY output → WebSocket broadcast + scrollback accumulation,
 * and PTY exit → client notification + map cleanup.
 */
function wirePtyEvents(entry) {
  entry.pty.onData(data => {
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

  entry.pty.onExit(({ exitCode }) => {
    for (const client of entry.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'exit', exitCode }));
      }
    }
    // Clean up under whatever key we're stored as (might already be re-keyed)
    for (const [key, val] of ptys.entries()) {
      if (val === entry) { ptys.delete(key); break; }
    }
    notifyPtyRemoved(entry);
  });
}

/**
 * Core spawn logic shared by spawnPty() and spawnNewSession().
 * Returns the PTY entry or null if spawning fails.
 *
 * On failure, logs a detailed diagnostic and (if a ws client is provided)
 * sends a user-friendly error to the terminal instead of crashing the server.
 */
function doSpawn(providerId, command, args, cwd, cols, rows, ws, envOverrides = {}) {
  try {
    if (ensurePtySpawnHelperIsExecutable()) {
      console.info('[pty] Restored executable permission to node-pty spawn-helper.');
    }
    const p = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: interactivePtyEnv(providerId, envOverrides),
    });

    return {
      pty: p,
      clients: new Set(),
      scrollback: [],
      scrollbackSize: 0,
      startedAt: Date.now(),
      lastClientDetachedAt: null,
    };
  } catch (err) {
    // Log full diagnostic server-side
    console.error(`[pty] Failed to spawn PTY: ${err.message}`);
    console.error(`[pty]   command=${command}, args=${JSON.stringify(args)}, cwd=${cwd}, platform=${process.platform}, arch=${process.arch}`);
    console.error(`[pty]   SHELL=${process.env.SHELL || '(unset)'}, node=${process.version}`);

    // Send a helpful message to the browser terminal
    if (ws) {
      const isSpawnp = /posix_spawnp|spawn/i.test(err.message);
      const hint = isSpawnp
        ? 'The local node-pty helper could not start. The dashboard repaired its executable permission when possible.\n\r' +
          'If this persists, run: rm -rf node_modules && npm install\n\r' +
          `(current platform: ${process.platform}/${process.arch}, node ${process.version})`
        : err.message;
      sendPtyError(ws, `Terminal error: ${hint}`);
    }

    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Spawns a new PTY for the given session, or attaches to existing one.
 * workingDir: the Codex thread cwd — used as PTY cwd for resume/new sessions.
 * ws: initial WebSocket client to attach.
 */
function spawnPty(providerId, sessionId, workingDir, ws, cols = 80, rows = 24, options = {}) {
  const key = ptyKey(providerId, sessionId);
  if (ptys.has(key)) {
    // Attach new client to existing PTY — replay scrollback so the terminal
    // isn't blank after a session switch.
    const entry = ptys.get(key);
    replayScrollback(entry, ws);
    entry.clients.add(ws);
    entry.lastClientDetachedAt = null;
    // Resize the PTY to the new client's dimensions. This is critical for
    // pending sessions where the PTY was spawned with default dimensions
    // before any client connected. Without this, line wrapping and cursor
    // positioning are calculated for the wrong terminal size.
    try { entry.pty.resize(Math.max(1, cols), Math.max(1, rows)); } catch {}
    return entry.pty;
  }

  // Use the session's working directory so Codex resumes with the same root.
  // Fall back to home if the directory no longer exists (deleted repo, etc.).
  const cwd = (workingDir && fs.existsSync(workingDir)) ? workingDir : os.homedir();
  const provider = getProvider(providerId);
  const shell = getShell();
  const { command, args } = provider.buildCommand(sessionId, {
    shell,
    platform: process.platform,
    remoteEndpoint: options.remoteEndpoint || null,
    // Remote Codex uses the app-server process as its implicit CWD. Pass the
    // selected root explicitly so a new thread cannot inherit the dashboard
    // checkout instead of the project chosen by the user.
    workingDirectory: cwd,
  });

  const entry = doSpawn(provider.id, command, args, cwd, cols, rows, ws);
  if (!entry) return null;

  entry.providerId = provider.id;
  entry.sessionId = sessionId;
  entry.controlPlane = Boolean(options.remoteEndpoint);
  entry.clients.add(ws);
  ptys.set(key, entry);
  // Wire events immediately after map insertion so no PTY output is lost
  wirePtyEvents(entry);

  return entry.pty;
}

/**
 * Attaches a WebSocket client to an existing PTY session.
 * If no PTY exists yet, spawns one in the session's working directory.
 *
 * If spawning fails (e.g. node-pty native module mismatch), the server stays
 * alive and the client receives an error message in the terminal pane.
 */
function attachClient(providerId, sessionId, workingDir, ws, cols, rows, options = {}) {
  const p = spawnPty(providerId || DEFAULT_PROVIDER_ID, sessionId, workingDir, ws, cols, rows, options);
  if (!p) return; // spawn failed — error already sent to ws

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      // Look up the PTY by scanning for the entry that owns this WS client.
      // This survives rekey (where the map key changes from pending-xxx to
      // the real session UUID) — ptys.get(sessionId) would use the stale
      // closure-captured key and return undefined after rekey.
      let entry = null;
      for (const [, e] of ptys) {
        if (e.clients.has(ws)) { entry = e; break; }
      }
      if (!entry) return;

      if (msg.type === 'input') {
        // Strip any xterm.js programmatic responses that slipped through
        // the client-side filter (defense in depth).
        const cleaned = msg.data.replace(XTERM_RESPONSE_RE, '');
        if (cleaned) entry.pty.write(cleaned);
      } else if (msg.type === 'resize') {
        entry.pty.resize(
          Math.max(1, msg.cols || 80),
          Math.max(1, msg.rows || 24)
        );
      }
    } catch {
      // Ignore malformed messages
    }
  });

  const removeClient = () => {
    // Look up by identity scan in case the entry was re-keyed
    for (const [, entry] of ptys) {
      if (!entry.clients.delete(ws)) continue;
      if (entry.clients.size === 0) {
        entry.lastClientDetachedAt = Date.now();
        if (terminateDetachedCollision(entry)) {
          for (const [key, value] of ptys) {
            if (value === entry) ptys.delete(key);
          }
          notifyPtyRemoved(entry);
        }
      }
      break;
    }
  };
  ws.on('close', removeClient);
  ws.on('error', removeClient);
}

/**
 * Kills the PTY for a given session and notifies all clients.
 */
function killPty(providerId, sessionId) {
  if (sessionId === undefined) {
    sessionId = providerId;
    providerId = DEFAULT_PROVIDER_ID;
  }
  const key = ptyKey(providerId, sessionId);
  const entry = ptys.get(key);
  if (!entry) return false;

  try {
    entry.pty.kill();
  } catch {
    // Already dead
  }
  ptys.delete(key);
  notifyPtyRemoved(entry);
  return true;
}

/**
 * Returns whether a PTY is currently running for a session.
 */
function isPtyActive(providerId, sessionId) {
  if (sessionId === undefined) {
    sessionId = providerId;
    providerId = DEFAULT_PROVIDER_ID;
  }
  return ptys.has(ptyKey(providerId, sessionId));
}

function pendingPtyState(providerId, sessionId) {
  const entry = ptys.get(ptyKey(providerId, sessionId));
  if (!entry) return null;
  return {
    active: true,
    processId: entry.pty.pid,
    startedAt: entry.startedAt,
    clientCount: entry.clients.size,
    detachedAt: entry.clients.size === 0
      ? entry.lastClientDetachedAt ?? entry.startedAt
      : null,
  };
}

function isPtyControlPlane(providerId, sessionId) {
  if (sessionId === undefined) {
    sessionId = providerId;
    providerId = DEFAULT_PROVIDER_ID;
  }
  return Boolean(ptys.get(ptyKey(providerId, sessionId))?.controlPlane);
}

/**
 * Returns active PTY session IDs.
 */
function activePtySessions(providerId = null) {
  return [...ptys.entries()]
    .filter(([, entry]) => !providerId || entry.providerId === providerId)
    .map(([key, entry]) => ({
      key,
      providerId: entry.providerId,
      sessionId: entry.sessionId,
      controlPlane: Boolean(entry.controlPlane),
      // Compatibility alias for v2/browser clients. This describes the PTY
      // transport, not whether native Adaptive routing is currently enabled.
      adaptive: Boolean(entry.controlPlane),
    }));
}

/**
 * Spawns a brand-new Codex session in the given working directory.
 * The PTY is stored under `tempKey` until the real session ID is detected from the
 * DB, at which point the caller should call rekeyPty(tempKey, realSessionId).
 *
 * No WebSocket client is attached initially — the client will connect via the
 * standard /ws/terminal/:sessionId path once the real ID is known.
 */
function spawnNewSession(providerId, tempKey, workingDir, cols = 80, rows = 24, options = {}) {
  if (workingDir === undefined) {
    workingDir = tempKey;
    tempKey = providerId;
    providerId = DEFAULT_PROVIDER_ID;
  }
  const cwd = (workingDir && fs.existsSync(workingDir)) ? workingDir : os.homedir();
  const provider = getProvider(providerId);
  const shell = getShell();
  const { command, args } = provider.buildCommand(null, {
    shell,
    platform: process.platform,
    remoteEndpoint: options.remoteEndpoint || null,
    workingDirectory: cwd,
  });
  const pendingEnvironment = typeof provider.pendingSessionEnvironment === 'function'
    ? provider.pendingSessionEnvironment(options.correlationId)
    : {};

  const entry = doSpawn(provider.id, command, args, cwd, cols, rows, null, pendingEnvironment);
  if (!entry) return null;

  entry.providerId = provider.id;
  entry.sessionId = tempKey;
  entry.controlPlane = Boolean(options.remoteEndpoint);
  entry.correlationId = options.correlationId || null;
  ptys.set(ptyKey(provider.id, tempKey), entry);
  wirePtyEvents(entry);

  return entry;
}

/**
 * Re-keys a PTY entry in the map from oldKey to newKey.
 * This lets attachClient(realSessionId, ...) find the already-running PTY
 * instead of spawning a duplicate.
 */
function rekeyPty(providerId, oldKey, newKey) {
  if (newKey === undefined) {
    newKey = oldKey;
    oldKey = providerId;
    providerId = DEFAULT_PROVIDER_ID;
  }
  const oldPtyKey = ptyKey(providerId, oldKey);
  const newPtyKey = ptyKey(providerId, newKey);
  const entry = ptys.get(oldPtyKey);
  if (!entry) return false;
  if (ptys.has(newPtyKey)) return false;
  ptys.delete(oldPtyKey);
  entry.sessionId = newKey;
  ptys.set(newPtyKey, entry);
  return true;
}

function resolvePtyRekeyCollision(providerId, pendingKey, realSessionId) {
  const pendingEntry = ptys.get(ptyKey(providerId, pendingKey));
  const canonicalEntry = ptys.get(ptyKey(providerId, realSessionId));
  if (!markPtyRekeyCollision(pendingEntry, canonicalEntry, realSessionId)) return false;

  if (terminateDetachedCollision(pendingEntry)) {
    ptys.delete(ptyKey(providerId, pendingKey));
    notifyPtyRemoved(pendingEntry);
  }
  return true;
}

function markPtyRekeyCollision(pendingEntry, canonicalEntry, realSessionId) {
  if (!pendingEntry || !canonicalEntry || pendingEntry === canonicalEntry) return false;
  pendingEntry.collisionRealId = realSessionId;
  const message = '\r\n\x1b[33mThis session also has a canonical terminal. This terminal remains available until you close it; its process will close after detaching.\x1b[0m\r\n';
  for (const client of pendingEntry.clients) {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'output', data: message }));
    }
  }
  return true;
}

function terminateDetachedCollision(entry) {
  if (!entry?.collisionRealId || entry.clients.size > 0) return false;
  try { entry.pty.kill(); } catch {}
  return true;
}

/**
 * Startup self-test: spawns a minimal PTY to verify node-pty's native module
 * works on this platform.  Called once at server boot so a broken native addon
 * is caught immediately with a clear message instead of on the first WebSocket
 * connection.
 *
 * Returns true if healthy, false (with logged guidance) if not.
 */
function validatePty() {
  const shell = getShell();
  try {
    if (ensurePtySpawnHelperIsExecutable()) {
      console.info('[pty] Restored executable permission to node-pty spawn-helper.');
    }
    const p = pty.spawn(shell, ['--version'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: interactivePtyEnv(DEFAULT_PROVIDER_ID),
    });
    p.kill();
    return true;
  } catch (err) {
    console.error('\n[pty] *** node-pty self-test failed ***');
    console.error(`[pty] Error: ${err.message}`);
    console.error(`[pty] Platform: ${process.platform}/${process.arch}, Node: ${process.version}`);
    console.error(`[pty] Shell: ${shell}`);
    console.error('[pty]');
    console.error('[pty] This usually means the native module was compiled for a different OS or architecture.');
    console.error('[pty] Fix:  rm -rf node_modules && npm install');
    console.error('[pty]');
    console.error('[pty] The dashboard will start, but terminal sessions will show an error.\n');
    return false;
  }
}

module.exports = {
  attachClient,
  killPty,
  isPtyActive,
  isPtyControlPlane,
  pendingPtyState,
  activePtySessions,
  spawnNewSession,
  rekeyPty,
  resolvePtyRekeyCollision,
  markPtyRekeyCollision,
  terminateDetachedCollision,
  onPtyRemoved,
  validatePty,
  interactivePtyEnv,
  ensurePtySpawnHelperIsExecutable,
};

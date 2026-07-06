# Codex App-Server Native Inputs

## Decision under review

Move the Codex provider toward a two-plane session architecture:

- **Terminal plane:** xterm.js remains the visible Codex CLI experience. A PTY
  runs `codex --remote ...` so the terminal UI remains authentic.
- **Control plane:** the dashboard maintains a connection to the same local
  Codex app-server and uses its structured protocol for browser-originated
  input that cannot be represented safely as terminal bytes, especially image
  attachments.

This is the architectural version of option 2. It is intentionally larger than
the current text-paste fix because a PTY has no standard image-input channel.

## Current boundary

Today `server/pty-manager.js` starts `codex resume <sessionId>` and forwards
JSON WebSocket messages containing terminal `input` bytes. `Terminal.jsx`
captures browser paste events and forwards only `text/plain` through xterm.
That makes normal text paste reliable, but it cannot create a Codex image input.

The installed Codex app-server schema supports structured `UserInput` values
including:

```json
{ "type": "text", "text": "..." }
{ "type": "localImage", "path": "/absolute/path/image.png" }
```

## Proposed flow

1. The dashboard server owns one loopback-only Codex app-server transport for
   the Codex provider, with a private random endpoint and lifecycle cleanup.
2. Codex PTYs launch the TUI through that app-server using `codex --remote`,
   while preserving the existing terminal WebSocket and scrollback behavior.
3. The browser captures image clipboard items in the paste event and sends them
   to a session-scoped upload endpoint.
4. The server validates the upload, writes it outside the webroot with a
   generated filename and restrictive permissions, and associates it with the
   requested session.
5. The UI presents the image as a pending attachment in a small native-input
   composer. Text-only input continues to use the CLI composer directly.
6. On submit, the server sends `turn/start` (or `turn/steer` when appropriate)
   to the same Codex thread using `text` and `localImage` input items. The PTY
   TUI receives and renders the turn through the shared app-server connection.
7. The server removes temporary attachment files after the turn completes or
   after a bounded expiry period.

## Why the composer is needed

An image cannot be inserted into the existing TUI draft buffer through a PTY.
Sending a path as text is only a workaround: it changes the user request and
does not create a Codex attachment. A browser-side attachment state is the
smallest UI addition that preserves a real CLI terminal for ordinary work
while giving image input a structured submission path.

## Implementation phases

### Phase 1: transport spike

- Add an app-server manager with a loopback-only WebSocket transport.
- Start it under the dashboard lifecycle and implement `initialize` plus
  `thread/resume` health checks.
- Verify `codex --remote <endpoint> resume <sessionId>` renders an existing
  session and that a second protocol client can observe the same thread.
- Keep the current PTY launch path available behind a provider capability flag
  until the spike passes.

### Phase 2: session integration

- Replace Codex PTY commands with the remote form for existing and new
  sessions.
- Keep pending-session rekeying, resize, scrollback, reconnect, and kill
  semantics intact.
- Ensure one app-server connection is reused per dashboard process and that
  child processes and loopback listeners are shut down on restart.

### Phase 3: native image input

- Add a provider-scoped upload route with strict size and content validation.
- Accept only PNG/JPEG initially; verify magic bytes instead of trusting the
  browser MIME type.
- Store files in a private temporary directory, use generated names, set
  restrictive permissions, and never expose uploaded paths as static files.
- Add session authorization checks even though this is a local single-user
  dashboard.
- Add browser paste handling for image clipboard items and attachment state.
- Add the smallest submit composer needed to send structured text plus image
  items to the app-server.

### Phase 4: verification and rollout

- Add unit tests for protocol message construction, upload validation, expiry,
  and session/path authorization.
- Add Playwright coverage for text paste, image paste, mixed text/image input,
  upload rejection, and reconnect behavior.
- Run build, docs checks, serial smoke tests, and a real Codex session test.
- Roll out behind a Codex capability flag until the remote TUI path is proven.

## Security requirements

- Bind the app-server to loopback only; do not expose it through Express or a
  non-local interface.
- Use a random endpoint/port and validate the app-server child process before
  accepting protocol traffic.
- Treat session IDs and working directories as opaque server-side values; do
  not let browser input select arbitrary files or invoke shell commands.
- Reject unknown upload fields, oversized bodies, unsupported MIME types, bad
  image signatures, and malformed protocol messages.
- Use generated filenames, private storage, restrictive permissions, bounded
  retention, and cleanup on all success and failure paths.
- Do not log image contents, credentials, raw clipboard data, or full local
  paths unnecessarily.

## Peer review findings before implementation

1. **The remote TUI handshake is the first blocker.** The exact Codex CLI
   command and app-server protocol behavior must be verified against the
   installed version before changing the provider launch path.
2. **The app-server and TUI must share the same thread.** A protocol client
   sending `turn/start` to a different thread would look successful while the
   visible terminal remains unchanged.
3. **Active-turn semantics need explicit handling.** `turn/start` is for a new
   request; `turn/steer` is for an active turn. The UI must not silently submit
   an attachment at the wrong lifecycle point.
4. **Image paste cannot be made native by PTY injection.** Any implementation
   that only writes a path, base64, or escape sequence to the PTY should be
   treated as a fallback, not option 2.
5. **The old PTY path needs a rollback switch.** Existing sessions and pending
   new-session behavior make an all-at-once migration unnecessarily risky.

## Transport spike result

Verified locally on 2026-06-30 with Codex CLI `0.142.4`:

- `codex app-server --listen ws://127.0.0.1:45991` started successfully.
- A second protocol client completed `initialize` and `thread/resume` for an
  existing session and received the same thread ID.
- `codex --remote ws://127.0.0.1:45991 resume <sessionId>` rendered the existing
  Codex TUI successfully.

The first architectural gate passes. The remaining work is the dashboard
manager, lifecycle migration, and browser-side structured-input composer.

## Acceptance criteria

- Existing Codex sessions open in a visually authentic CLI TUI through the
  dashboard.
- Ordinary keyboard shortcuts, text paste, resize, reconnect, and scrollback
  remain functional.
- Pasting a PNG or JPEG from the browser produces a visible pending attachment
  and submits it as a Codex `localImage` input, without a false clipboard error.
- The agent can inspect the image from the resulting turn.
- Invalid, oversized, unauthorized, expired, and malformed uploads are
  rejected without leaving files behind.
- The feature is covered by automated tests and a real live-session smoke test.

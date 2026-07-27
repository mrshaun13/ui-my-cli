# API Reference

All REST endpoints return JSON. Error responses use `{ "error": "..." }`
with an appropriate HTTP status code.

## REST Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Server health check — returns `ok`, API compatibility version, default provider, provider availability, active PTY count, uptime seconds |
| `GET` | `/api/providers` | Provider catalog — returns Codex/Devin labels, commands, availability, version, and UI metadata |
| `GET` | `/api/native/launch/status` | Capability probe used by the native dashboard to find a browser dashboard that supports reciprocal launching. |
| `POST` | `/api/native/launch` | Focus or start the installed Codex Native app through Windows/WSL2 PowerShell or macOS LaunchServices. |
| `GET` | `/api/codex/adaptive/models` | Authenticated Codex model catalog used by native Adaptive routing, including each visible model's supported reasoning efforts and service tiers. |
| `POST` | `/api/codex/sessions/:id/adaptive/submit` | Classify and submit one native Adaptive prompt through the shared Codex app-server thread. For a pending session, body `{ text, preference?, workingDir }` starts the first turn before returning its real `sessionId`; later turns use `{ text, preference? }`. |
| `GET` | `/api/:providerId/terminals` | List active PTYs for one provider as an array of `{ key, providerId, sessionId, controlPlane, adaptive }`; `adaptive` is a compatibility alias for the control-plane transport flag. |
| `GET` | `/api/terminals` | Compatibility alias for the default provider active-PTY list. |
| `GET` | `/api/:providerId/stats` | Provider-scoped dashboard analytics — activity, tools, tokens, MCP servers, skills, plugins. Codex includes 1d/2d/7d/14d/30d/all-time token and credit-estimate rollups by model, project, and session, and supports `statsMode=combined|triage|codex` cohort switching. |
| `GET` | `/api/stats` | Compatibility alias for `/api/codex/stats` unless `UI_MY_CLI_DEFAULT_PROVIDER` overrides the default; accepts the same stats query params |
| `GET` | `/api/:providerId/latest-prompt` | Most recent user prompt from the selected provider local state |
| `GET` | `/api/latest-prompt` | Compatibility alias for the default provider latest prompt |
| `GET` | `/api/:providerId/sessions` | List all active (non-archived) sessions for one provider with derived status |
| `GET` | `/api/sessions` | Compatibility alias for the default provider session list |
| `GET` | `/api/:providerId/sessions/archived` | List archived (hidden) sessions for one provider |
| `GET` | `/api/sessions/archived` | Compatibility alias for default provider archived sessions |
| `GET` | `/api/:providerId/sessions/search` | Provider-scoped full-text session search — query param `q` (required), `archived=1` to include archived sessions. |
| `GET` | `/api/sessions/search` | Compatibility alias for default provider search |
| `GET` | `/api/:providerId/repos` | List all unique repos (working directories) from one provider's past sessions |
| `GET` | `/api/repos` | Compatibility alias for default provider repos |
| `POST` | `/api/:providerId/sessions/create` | Start a new session for one provider in the given working directory (body: `{ workingDir: string, controlPlane?: boolean }`); returns `{ tempKey, controlPlane }`, where `controlPlane` reports the transport actually selected |
| `POST` | `/api/sessions/create` | Compatibility alias for default provider session creation |
| `GET` | `/api/:providerId/sessions/:id/preview` | Provider-scoped rich read-only session detail — chat history, stats, top tools |
| `GET` | `/api/sessions/:id/preview` | Rich read-only session detail — chat history, stats, top tools |
| `GET` | `/api/:providerId/sessions/:id/conversation` | Provider-scoped paginated user↔assistant conversation turns for a session. |
| `GET` | `/api/sessions/:id/conversation` | Paginated user↔assistant conversation turns for a session. Query params: `offset` (number of turns to skip from end, default 0), `limit` (max turns to return, 0 = all, default 50). Returns `{ turns, totalTurns, hasMore }`. |
| `GET` | `/api/:providerId/sessions/:id/subagents` | Provider-scoped subagent timeline. Codex joins parent `sub_agent_activity` events with child-thread metadata and result previews; Devin reads legacy run_subagent lifecycle data. |
| `GET` | `/api/sessions/:id/subagents` | Compatibility alias for default provider subagents. |
| `GET` | `/api/:providerId/sessions/:id/context` | Estimated context breakdown for one provider session. Returns `{ categories, totalUsed, maxContext, freeTokens, compactionCount, model }`. |
| `GET` | `/api/sessions/:id/context` | Compatibility alias for default provider context. |
| `GET` | `/api/:providerId/sessions/:id/config` | Per-session provider configuration metadata. Returns `{ rules, activeSkills, permissions, model, reasoningEffort, permissionMode }` where available. |
| `GET` | `/api/sessions/:id/config` | Compatibility alias for default provider config. |
| `GET` | `/api/:providerId/sessions/:id` | Single provider session with `ptyActive` flag |
| `GET` | `/api/sessions/:id` | Single session with `ptyActive` flag |
| `POST` | `/api/:providerId/sessions/:id/rename` | Update a provider session title (body: `{ title: string }`) |
| `POST` | `/api/sessions/:id/rename` | Update session title (body: `{ title: string }`) |
| `POST` | `/api/:providerId/sessions/:id/kill-pty` | Kill the active provider-scoped PTY for a session without archiving it |
| `POST` | `/api/sessions/:id/kill-pty` | Kill the active PTY for a session without archiving it |
| `DELETE` | `/api/:providerId/sessions/:id` | Archive a provider session — kills PTY, hides from active list (reversible) |
| `DELETE` | `/api/sessions/:id` | Archive a session — kills PTY, hides from active list (reversible) |
| `POST` | `/api/:providerId/sessions/:id/restore` | Restore an archived provider session to the active list |
| `POST` | `/api/sessions/:id/restore` | Restore an archived session to the active list |

## WebSocket Endpoints

### `/ws/:providerId/terminal/:sessionId`

PTY bridge — bidirectional terminal I/O. Connect with a session ID to attach
to (or spawn) that provider session's terminal process.

Compatibility alias: `/ws/terminal/:sessionId` uses the default provider.

**Optional query parameters:** `cols` and `rows` set the initial PTY size.
For Codex, `controlPlane=1` requests the shared app-server transport used by
native Adaptive routing; if it cannot start, the server falls back to a direct
terminal. The legacy `adaptive=1` spelling remains a compatibility alias.

**Client → Server:**

| Message type | Fields |
| --- | --- |
| `input` | `{ type: "input", data: string }` — keystrokes to send to PTY |
| `resize` | `{ type: "resize", cols: number, rows: number }` — terminal resize event |

**Server → Client:**

| Message type | Fields |
| --- | --- |
| `output` | `{ type: "output", data: string }` — raw PTY output chunk |
| `exit` | `{ type: "exit", exitCode: number }` — PTY process exited |

New connections receive a replay of the last 256 KB of PTY output immediately
on connect, so switching back to a session shows its terminal history.

### `/ws/:providerId/status`

Live session status feed. The server pushes updates automatically — no client
requests needed after the initial connection.

Compatibility alias: `/ws/status` uses the default provider.

**Server → Client:**

| Message type | Fields | Trigger |
| --- | --- | --- |
| `sessions` | `{ type: "sessions", data: Session[] }` | Every 3 seconds + immediately on connect + after mutations |
| `latest-prompt` | `{ type: "latest-prompt", data: { content, timestamp, isShell } }` | DB write events + immediately on connect |
| `rekey` | `{ type: "rekey", tempKey: string, realId: string }` | A pending session persists and receives its provider session ID |
| `pending-expired` | `{ type: "pending-expired", tempKey: string }` | A pending terminal exits before its session persists |

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7575` | HTTP server port |
| `NODE_ENV` | `—` | Set to `production` to enable static file serving from `client/dist/` |
| `SHELL` | `—` | Shell binary for the node-pty process (falls back to `/bin/zsh` on macOS, then `/bin/bash`, then `/bin/sh`) |
| `CODEX_HOME` | `—` | Override the Codex home directory (default: `~/.codex`) |
| `CODEX_STATE_DB_PATH` | `—` | Override the auto-detected Codex state SQLite database path |
| `UI_MY_CLI_DB_PATH` | `—` | Override the dashboard metadata database path |
| `TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR` | `—` | Override the exact transcript-pipeline `data/headless-sessions` ledger directory |
| `TRANSCRIPT_PIPELINE_DIR` | `—` | Override the transcript-pipeline checkout used to discover Codex headless run ledgers |
| `UI_MY_CLI_DEFAULT_PROVIDER` | `codex` | Override the compatibility/default provider for legacy `/api/...` and `/ws/...` aliases (default: `codex`) |
| `CODEX_BIN` | `—` | Override Codex executable discovery; otherwise checks `~/.local/bin`, PATH, Homebrew, and nvm locations |
| `PATH` | `—` | Inherited executable search path; native macOS startup also checks Homebrew and nvm locations explicitly |
| `HOME` | `—` | User home used for Codex, local installs, and nvm discovery |
| `DEVIN_DB_PATH` | `—` | Override the auto-detected Devin `sessions.db` path |
| `DEVIN_DASHBOARD_DB_PATH` | `—` | Override the Devin dashboard metadata database path |
| `XDG_DATA_HOME` | `—` | Override the XDG data directory (default: `~/.local/share`); affects DB path on all platforms |
| `APPDATA` | `—` | Windows `%APPDATA%` directory — used to find the database path on Windows |

## Client localStorage Keys

These keys are written by the client to persist user preferences across
browser reloads. They are never sent to the server.

| Key | File |
| --- | --- |
| `codex-dash:sidebar-collapsed` | `App.jsx` |
| `codex-dash:sidebar-width` | `App.jsx` |
| `agent-dash:selected-provider` | `App.jsx` |

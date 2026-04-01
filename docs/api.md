# API Reference

All REST endpoints return JSON. Error responses use `{ "error": "..." }`
with an appropriate HTTP status code.

## REST Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Server health check — returns `ok`, active PTY count, uptime seconds |
| `GET` | `/api/stats` | Full dashboard analytics — activity, tools, tokens, MCP servers, skills, plugins |
| `GET` | `/api/latest-prompt` | Most recent user prompt from the `prompt_history` table |
| `GET` | `/api/sessions` | List all active (non-archived) sessions with derived status |
| `GET` | `/api/sessions/archived` | List archived (hidden) sessions |
| `GET` | `/api/sessions/search` | Full-text session search — query param `q` (required), `archived=1` to include archived sessions. Searches title, working directory, prompt history, and user-role message content. Returns same shape as the sessions list. |
| `GET` | `/api/repos` | List all unique repos (working directories) from past sessions |
| `POST` | `/api/sessions/create` | Start a new Devin session in the given working directory (body: `{ workingDir: string }`); returns `{ sessionId }` |
| `GET` | `/api/sessions/:id/preview` | Rich read-only session detail — chat history, stats, top tools |
| `GET` | `/api/sessions/:id/conversation` | Paginated user↔assistant conversation turns for a session. Query params: `offset` (number of turns to skip from end, default 0), `limit` (max turns to return, 0 = all, default 50). Returns `{ turns, totalTurns, hasMore }`. |
| `GET` | `/api/sessions/:id/subagents` | Subagent lifecycle data for a session — launch, confirmation, and completion events mined from `message_nodes`. Returns an array of `{ id, title, profile, isBackground, agentId, task, launchedAt, completedAt, durationSec, resultPreview }`. |
| `GET` | `/api/sessions/:id/context` | Context window breakdown for a session — estimated token counts per category (system prompt, user messages, assistant messages, tool calls, tool results) plus free capacity. Proportions are computed from character counts in the active context (post-compaction) and scaled to match the actual `num_tokens_preceding` value. Returns `{ categories, totalUsed, maxContext, freeTokens, compactionCount, model }`. |
| `GET` | `/api/sessions/:id/config` | Per-session configuration extracted from `cogs_json` — active rules files, invoked skills, permission grants, current model, and permission mode. Returns `{ rules, activeSkills, permissions, model, permissionMode }`. |
| `GET` | `/api/sessions/:id` | Single session with `ptyActive` flag |
| `POST` | `/api/sessions/:id/rename` | Update session title (body: `{ title: string }`) |
| `POST` | `/api/sessions/:id/kill-pty` | Kill the active PTY for a session without archiving it |
| `DELETE` | `/api/sessions/:id` | Archive a session — kills PTY, hides from active list (reversible) |
| `POST` | `/api/sessions/:id/restore` | Restore an archived session to the active list |

## WebSocket Endpoints

### `/ws/terminal/:sessionId`

PTY bridge — bidirectional terminal I/O. Connect with a session ID to attach
to (or spawn) that session's terminal process.

**Optional query parameters:** `?cols=220&rows=50`

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

### `/ws/status`

Live session status feed. The server pushes updates automatically — no client
requests needed after the initial connection.

**Server → Client:**

| Message type | Fields | Trigger |
| --- | --- | --- |
| `sessions` | `{ type: "sessions", data: Session[] }` | Every 3 seconds + immediately on connect + after mutations |
| `latest-prompt` | `{ type: "latest-prompt", data: { content, timestamp, isShell } }` | DB write events + immediately on connect |

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7575` | HTTP server port |
| `NODE_ENV` | `—` | Set to `production` to enable static file serving from `client/dist/` |
| `DEVIN_VERSION` | `—` |  |
| `SHELL` | `—` | Shell binary for the node-pty process (falls back to `/bin/zsh` on macOS, then `/bin/bash`, then `/bin/sh`) |
| `DEVIN_DB_PATH` | `—` | Override the auto-detected Devin CLI SQLite database path |
| `DEVIN_DASHBOARD_DB_PATH` | `—` | Override the dashboard.db path (defaults to same dir as sessions.db) |
| `XDG_DATA_HOME` | `—` | Override the XDG data directory (default: `~/.local/share`); affects DB path on all platforms |
| `APPDATA` | `—` | Windows `%APPDATA%` directory — used to find the database path on Windows |

## Client localStorage Keys

These keys are written by the client to persist user preferences across
browser reloads. They are never sent to the server.

| Key | File |
| --- | --- |
| `devin-dash:cold-days` | `Sidebar.jsx` |
| `devin-dash:search-archived` | `Sidebar.jsx` |
| `devin-dash:viewed-at` | `useStatusFeed.js` |

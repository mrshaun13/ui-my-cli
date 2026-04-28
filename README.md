# Devin Dashboard

A browser-based dashboard for managing multiple Devin CLI agent sessions. Replaces tab-hunting with a click-driven UI: real embedded terminals, live status badges, analytics, and one-click agent switching.

## Features

- **Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds
- **Real terminals** — xterm.js + node-pty: identical to running `devin --resume` in your shell
- **Click to switch** — click any agent in the sidebar to attach its live terminal; switching is instant with scrollback preserved
- **New session** — floating "+" button in the sidebar lets you start a new Devin session in any previously-used repo; the terminal opens automatically
- **Session preview** — click the status badge to open a read-only view of any session's chat history without spawning a PTY
- **Inline rename** — double-click any session title to rename it (writes back to the Devin CLI sessions database)
- **Needs-your-input filter** — one click to show only agents waiting for a reply
- **Repo filter pills** — filter sessions by project; selection persists across reloads
- **Hot/cold grouping** — recent sessions at top, old idle ones behind a configurable day divider
- **Archive / restore** — hide sessions from the list without deleting them; restore from the collapsible drawer at the bottom of the sidebar
- **Analytics dashboard** — activity heatmap, project combo chart (duration + turns + sessions), token usage, tool call breakdown, model distribution, shown when no session is selected
- **Context window pie chart** — per-session donut chart showing context window composition (system prompt, user messages, assistant messages, tool calls, tool results, free capacity)
- **Environment banner** — global config overview on the dashboard home page showing active model, MCP servers, skills, and plugins with color-coded chips
- **Session config** — per-session configuration details (active rules, invoked skills, permissions) extracted from the session's cogs_json

## Quick Start

### Prerequisites

- **Node.js 18+** — `node --version` to check
- **Devin CLI installed and run at least once** — creates the sessions database
- **Native build tools** for node-pty compilation:
  - **Ubuntu / Debian / WSL2**: `sudo apt install build-essential python3`
  - **macOS**: `xcode-select --install`
  - **Windows**: [Visual Studio Build Tools](https://github.com/nodejs/node-gyp#on-windows) (native Windows untested; WSL2 is the recommended Windows path)

### Install & Run

```bash
git clone <repo-url> devin-dashboard
cd devin-dashboard
npm install        # installs server + client deps; node-pty compiles native bindings
npm run build      # compile the Vite client bundle
npm start          # start the dashboard server
```

Open **http://localhost:7575** in your browser.

### Development Mode (hot reload)

```bash
# Terminal 1 — server with auto-restart
node --watch server/index.js

# Terminal 2 — Vite client with HMR
cd client && npm run dev
```

The Vite dev server runs at **http://localhost:5173** and proxies all
`/api` and `/ws` calls to the server.

### PM2 (persistent background process)

```bash
npm run pm2:start    # build + start under PM2
npm run pm2:restart  # rebuild + restart
npm run pm2:stop     # stop
npm run pm2:logs     # tail logs
```

## Configuration

### Port

Default is `7575`. Override with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

### Database Path

The dashboard reads the Devin CLI SQLite database. Platform defaults:

| Platform | Default path |
| --- | --- |
| Linux / WSL2 | `~/.local/share/devin/cli/sessions.db` |
| macOS | `~/.local/share/devin/cli/sessions.db` |
| Windows | `%APPDATA%\devin\cli\sessions.db` |

Override with `DEVIN_DB_PATH`:

```bash
DEVIN_DB_PATH=/custom/path/sessions.db npm start
```

Session title renames are written back to the database, so they appear
in `devin list` and inside active sessions.

### All Environment Variables

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

## Architecture

```
server/
  server/index.js              Devin Dashboard — Express server with WebSocket support.
  server/sessions.js           Sessions module — reads (and selectively writes) the Devin CLI SQLite database.
  server/stats.js              Stats module — computes dashboard analytics from the Devin CLI SQLite DB
  server/pty-manager.js        PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients.
  server/db-path.js            Resolves Devin-related database paths across platforms.

client/src/
  client/src/App.jsx                               
  client/src/components/Sidebar.jsx                Sidebar — left panel listing all Devin sessions.
  client/src/components/AgentCard.jsx              AgentCard — one row in the sidebar representing a Devin session.
  client/src/components/Terminal.jsx               Terminal — xterm.js terminal connected to the server PTY via WebSocket.
  client/src/components/ControlBar.jsx             ControlBar — always-visible context strip at the bottom of the UI.
  client/src/components/DashboardSplash.jsx        DashboardSplash — shown when no session is selected.
  client/src/components/SessionPreview.jsx         SessionPreview — read-only session detail panel.
  client/src/hooks/useStatusFeed.js                useStatusFeed — subscribes to the server's /ws/status WebSocket
```

### WebSocket Protocol

**`/ws/terminal/:sessionId`** — PTY bridge

- Client → Server: `{ type: "input", data }` | `{ type: "resize", cols, rows }`
- Server → Client: `{ type: "output", data }` | `{ type: "exit", exitCode }`

**`/ws/status`** — live session status feed (server-push only)

- Server → Client: `{ type: "sessions", data: Session[] }` every 3 seconds
- Server → Client: `{ type: "latest-prompt", data }` on DB write events

### Status Detection

Derived from the last few `message_nodes` rows in the SQLite database:

| Status | Meaning |
| --- | --- |
| `active` | Devin is currently doing something (tool calls in flight, or a tool result arrived recently meaning next turn is imminent) |
| `question` | Devin's last message is text with no tool calls AND it ends with a question — Devin is blocked waiting for an answer |
| `finished` | Devin's last message is text with no tool calls, no question, and nothing has happened for >30s — work is done / paused |
| `idle` | no activity for >10 minutes, or no messages at all |

## Security Model

This dashboard is designed to run **locally on your development machine only**. It binds to `127.0.0.1` (localhost) and has **no authentication**. Anyone who can reach the port can view all sessions, spawn terminals, and modify session titles.

If you need remote access, use SSH port-forwarding instead of exposing the port:

```bash
ssh -L 7575:localhost:7575 your-remote-host
```

### Deployment model & dev-server posture

- **Production** runs `npm start` → Express (`server/index.js`) serving the pre-built static assets from `client/dist/`. Vite is `devDependencies` only and is **never** running in production.
- **Development** uses `cd client && npm run dev` to run the Vite dev server. `client/vite.config.js` explicitly pins `server.host = "127.0.0.1"` so the dev server is only reachable from the loopback interface. **Do not run `npm run dev -- --host` or remove that pin** — Vite has had multiple CVE-class issues (arbitrary file read via WebSocket `fetchModule`, `.map` path traversal) that are only exploitable when the dev server is reachable over the network.

### Dependency pinning policy

When a dependency has an active advisory against it, we **exact-pin** (no `^` / `~`) the patched version so a transitive install can't silently regress us onto a vulnerable copy. Other deps stay on their floated ranges to keep up with non-security patches automatically. Currently pinned for this reason:

- `vite` pinned to `6.4.2` in `client/package.json` (fixes the WebSocket `fetchModule` and `.map` traversal advisories in earlier 6.x).
- `postcss` pinned to `8.5.12` via `client/package.json#overrides` (fixes the `</style>` XSS advisory). The `overrides` block is scoped to the `client/` install root — `client/` runs its own `npm install` (its own lockfile) per the root `postinstall` script, which is what makes the override take effect there.

Run `npm audit` from both the repo root and `client/` after any dependency change to confirm zero advisories. When a future advisory clears, you can unpin to rejoin the floated range.

## License

MIT

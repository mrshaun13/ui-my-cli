# Codex Dashboard

A browser-based dashboard for managing multiple Codex CLI agent sessions. Replaces tab-hunting with a click-driven UI: real embedded terminals, live status badges, analytics, and one-click agent switching.

## Features

- **Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds
- **Real terminals** — xterm.js + node-pty: identical to running `codex resume` in your shell
- **Click to switch** — click any agent in the sidebar to attach its live terminal; switching is instant with scrollback preserved
- **New session** — floating "+" button in the sidebar lets you start a new Codex session in any previously-used repo; the terminal opens automatically
- **Session preview** — click the status badge to open a read-only view of any session's chat history without spawning a PTY
- **Inline rename** — double-click any session title to rename it (stored in the dashboard metadata database; Codex internals stay read-only)
- **Needs-your-input filter** — one click to show only agents waiting for a reply
- **Repo filter pills** — filter sessions by project; selection persists across reloads
- **Hot/cold grouping** — recent sessions at top, old idle ones behind a configurable day divider
- **Archive / restore** — hide sessions from the list without deleting them; restore from the collapsible drawer at the bottom of the sidebar
- **Analytics dashboard** — activity heatmap, project combo chart (duration + turns + sessions), token usage, tool call breakdown, model distribution, shown when no session is selected
- **Context window pie chart** — per-session donut chart showing context window composition (system prompt, user messages, assistant messages, tool calls, tool results, free capacity)
- **Environment banner** — global config overview on the dashboard home page showing active model, MCP servers, skills, and plugins with color-coded chips
- **Session config** — per-session Codex metadata: source, model, reasoning effort, sandbox policy, approval mode, skills, plugins, and MCP servers where available

## Quick Start

### Prerequisites

- **Node.js 18+** — `node --version` to check
- **Codex CLI installed and run at least once** — creates the sessions database
- **Native build tools** for node-pty compilation:
  - **Ubuntu / Debian / WSL2**: `sudo apt install build-essential python3`
  - **macOS**: `xcode-select --install`
  - **Windows**: [Visual Studio Build Tools](https://github.com/nodejs/node-gyp#on-windows) (native Windows untested; WSL2 is the recommended Windows path)

### Install & Run

```bash
git clone <repo-url> codex-dashboard
cd codex-dashboard
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

### Codex State Path

The dashboard reads local Codex state. Platform defaults:

| Platform | Default path |
| --- | --- |
| Linux / WSL2 | `~/.codex/state_*.sqlite` + `~/.codex/sessions/**/*.jsonl` |
| macOS | `~/.codex/state_*.sqlite` + `~/.codex/sessions/**/*.jsonl` |
| Windows / WSL | `~/.codex/state_*.sqlite` inside the active WSL/Linux home |

Override with `CODEX_HOME` or `CODEX_STATE_DB_PATH`:

```bash
CODEX_HOME=/custom/codex-home npm start
CODEX_STATE_DB_PATH=/custom/path/state_5.sqlite npm start
```

Session title renames are dashboard-local. Codex-owned state is read-only
except archive/restore operations performed through the Codex CLI.

### All Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7575` | HTTP server port |
| `NODE_ENV` | `—` | Set to `production` to enable static file serving from `client/dist/` |
| `SHELL` | `—` | Shell binary for the node-pty process (falls back to `/bin/zsh` on macOS, then `/bin/bash`, then `/bin/sh`) |
| `CODEX_HOME` | `—` | Override the Codex home directory (default: `~/.codex`) |
| `CODEX_STATE_DB_PATH` | `—` | Override the auto-detected Codex state SQLite database path |
| `UI_MY_CLI_DB_PATH` | `—` | Override the dashboard metadata database path |

## Architecture

```
server/
  server/index.js              Codex Dashboard — Express server with WebSocket support.
  server/sessions.js           Session facade for the dashboard.
  server/stats.js              Stats facade for local Codex sessions.
  server/pty-manager.js        PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients.
  server/db-path.js            Compatibility exports for legacy db-path imports.
  server/codex-paths.js        Resolves local Codex state paths.
  server/codex-store.js        Codex session adapter.
  server/dashboard-store.js    Dashboard-owned metadata for local Codex sessions.

client/src/
  client/src/App.jsx                               
  client/src/components/Sidebar.jsx                Sidebar — left panel listing all Codex sessions.
  client/src/components/AgentCard.jsx              AgentCard — one row in the sidebar representing a Codex session.
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

Derived from Codex thread metadata and rollout JSONL activity:

| Status | Meaning |
| --- | --- |
| `active` | Codex activity within the last 60 seconds. |
| `question` | Latest assistant text ends with `?`, indicating a likely prompt for your input. |
| `finished` | Recent non-idle session with no detected question. |
| `idle` | No activity for more than 10 minutes. |

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

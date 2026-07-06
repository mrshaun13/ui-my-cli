# Agent Dashboard

A browser-based dashboard for managing multiple local headless-agent sessions across Codex and Devin. Replaces tab-hunting with a click-driven UI: real embedded terminals, live status badges, analytics, and a hard provider switch that keeps each agent dashboard isolated.

## Features

- **Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds
- **Provider switch** — top-level Codex / Devin toggle; sessions, repo filters, tabs, stats, archives, and terminals are scoped to the selected provider
- **Real terminals** — xterm.js + node-pty: identical to running the selected provider CLI in your shell (`codex resume <id>` or `devin --resume <id>`)
- **Click to switch** — click any agent in the sidebar to attach its live terminal; switching is instant with scrollback preserved
- **New session** — floating "+" button in the sidebar lets you start a new Codex or Devin session in any previously-used repo; the terminal opens automatically
- **Session preview** — click the status badge to open a read-only view of any session's chat history without spawning a PTY
- **Inline rename** — double-click any session title to rename it (native Codex titles are written to Codex state so CLI, VS Code, and this dashboard stay aligned; external headless titles use dashboard metadata)
- **Needs-your-input filter** — one click to show only agents waiting for a reply
- **Repo filter pills** — filter sessions by project; selection persists across reloads
- **Hot/cold grouping** — recent sessions at top, old idle ones behind a configurable day divider
- **Archive / restore** — hide sessions from the list without deleting them; restore from the collapsible drawer at the bottom of the sidebar
- **Analytics dashboard** — activity heatmap, project combo chart (duration + turns + sessions), token usage, tool call breakdown, model distribution, and Codex stats cohort switching, shown when no session is selected
- **Context window pie chart** — per-session donut chart showing context window composition (system prompt, user messages, assistant messages, tool calls, tool results, free capacity)
- **Environment banner** — global config overview on the dashboard home page showing active model, MCP servers, skills, and plugins with color-coded chips
- **Session config** — per-session provider metadata: source, model, reasoning effort, sandbox policy, approval mode, skills, plugins, and MCP servers where available

## Quick Start

### Prerequisites

- **Node.js 18+** — `node --version` to check
- **Codex CLI installed and run at least once** — creates the Codex state database
- **Devin CLI installed and run at least once** — optional, required only for the Devin dashboard/provider
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

### Provider State Paths

The dashboard reads local provider state. Defaults:

| Provider | Default local state |
| --- | --- |
| Codex | `~/.codex/state_*.sqlite` + `~/.codex/sessions/**/*.jsonl` |
| Devin | `$XDG_DATA_HOME/devin/cli/sessions.db` or `~/.local/share/devin/cli/sessions.db` |

Override Codex with `CODEX_HOME` or `CODEX_STATE_DB_PATH`:

```bash
CODEX_HOME=/custom/codex-home npm start
CODEX_STATE_DB_PATH=/custom/path/state_5.sqlite npm start
```

Session title renames are dashboard-local. Codex-owned state is read-only
except archive/restore operations performed through the Codex CLI.
Override Devin with `DEVIN_DB_PATH` or `DEVIN_DASHBOARD_DB_PATH`.

### All Environment Variables

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
| `DEVIN_DB_PATH` | `—` | Override the auto-detected Devin `sessions.db` path |
| `DEVIN_DASHBOARD_DB_PATH` | `—` | Override the Devin dashboard metadata database path |
| `XDG_DATA_HOME` | `—` | Override the XDG data directory (default: `~/.local/share`); affects DB path on all platforms |
| `APPDATA` | `—` | Windows `%APPDATA%` directory — used to find the database path on Windows |

### Codex Stats Cohorts

The Codex stats endpoint accepts `statsMode=combined|triage|codex`.

- `combined` blends native Codex sessions with transcript-pipeline Codex headless triage runs.
- `triage` shows only transcript-pipeline Codex headless triage runs in the page-level charts.
- `codex` shows native Codex CLI / VS Code sessions without transcript-pipeline triage.

Tool Calls intentionally keeps its interactive/headless split stable across modes.

## Architecture

```
server/
  server/index.js              Agent Dashboard — Express server with WebSocket support.
  server/sessions.js           Codex compatibility session facade for legacy imports.
  server/stats.js              Codex compatibility stats facade for legacy imports.
  server/pty-manager.js        PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients.
  server/db-path.js            Compatibility exports for legacy db-path imports.
  server/codex-paths.js        Resolves local Codex state paths.
  server/codex-store.js        Codex session adapter.
  server/dashboard-store.js    Dashboard-owned metadata for external/headless sessions and other UI state.
  server/transcript-headless-store.js Read-only adapter for transcript-pipeline headless session ledgers.
  server/providers/index.js    Provider registry for local headless-agent adapters.
  server/providers/codex/index.js Codex provider adapter wiring local Codex state into the dashboard contract.
  server/providers/devin/index.js Devin provider adapter wiring legacy Devin CLI state into the dashboard contract.
  server/providers/devin/paths.js Resolves Devin-related database paths across platforms.

client/src/
  client/src/App.jsx                               
  client/src/components/Sidebar.jsx                Sidebar — left panel listing all sessions for the selected provider.
  client/src/components/AgentCard.jsx              AgentCard — one row in the sidebar representing a provider session.
  client/src/components/Terminal.jsx               Terminal — xterm.js terminal connected to the server PTY via WebSocket.
  client/src/components/ControlBar.jsx             ControlBar — always-visible context strip at the bottom of the UI.
  client/src/components/DashboardSplash.jsx        DashboardSplash — shown when no session is selected.
  client/src/components/SessionPreview.jsx         SessionPreview — read-only session detail panel.
  client/src/hooks/useStatusFeed.js                useStatusFeed — subscribes to the selected provider's status WebSocket
```

### WebSocket Protocol

**`/ws/:providerId/terminal/:sessionId`** — PTY bridge

- Client → Server: `{ type: "input", data }` | `{ type: "resize", cols, rows }`
- Server → Client: `{ type: "output", data }` | `{ type: "exit", exitCode }`

**`/ws/:providerId/status`** — live session status feed (server-push only)

- Server → Client: `{ type: "sessions", data: Session[] }` every 3 seconds
- Server → Client: `{ type: "latest-prompt", data }` on DB write events

### Status Detection

Derived by the selected provider adapter from local session state:

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

# Agent Dashboard

A browser dashboard for managing multiple local headless-agent sessions across Codex and Devin, plus a browser-free native frontend for Windows and macOS. Both surfaces share persistent server PTYs, live status, analytics, search, and session metadata; the native surface renders terminals through an Avalonia PTY view and can reattach after the UI exits.

## Features

- **Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds
- **Provider switch** — top-level Codex / Devin toggle; sessions, repo filters, tabs, stats, archives, and terminals are scoped to the selected provider
- **Native Windows and macOS frontend (development preview)** — Avalonia dashboard with push updates, deferred crash-safe conversation search, a compact functional project/age/visibility filter, actionable rich previews, responsive layouts, theme-aware control chrome, a custom pixel-art app identity, a rich compact session rail, a searchable Codex-or-local-shell project launcher, automatic terminal-bridge reconnect, toggleable keyboard-accessible cohort analytics, latest-prompt navigation, context composition, Codex subagent timelines, keyboard shortcuts, provider/quota health, and persistent Codex terminal reattachment; the current desktop package still requires a prepared local ui-my-cli checkout and is not a standalone distribution
- **Real terminals** — xterm.js + node-pty: identical to running the selected provider CLI in your shell (`codex resume <id>` or `devin --resume <id>`)
- **Click to switch** — click any agent in the sidebar to attach its live terminal; switching is instant with scrollback preserved
- **New session** — floating "+" button in the sidebar lets you start a new Codex or Devin session in any previously-used repo; the terminal opens automatically
- **Session preview** — click the status badge to open a read-only view of any session's chat history without spawning a PTY
- **Inline rename** — double-click any session title to rename it (native Codex titles are written to Codex state so CLI, VS Code, and this dashboard stay aligned; external headless titles use dashboard metadata)
- **Needs-your-input filter** — one click to show only agents waiting for a reply
- **Project filter** — compact count-labelled project selection replaces the unbounded native pill wall; selection persists across reloads
- **Persistent native terminals** — Codex PTYs stay in the independent dashboard service when the desktop UI closes; reopening the native app reattaches with buffered scrollback
- **Verified native updates** — checks stable GitHub Releases for the current OS/architecture, verifies exact size and SHA-256, waits for all active Codex sessions and local shells to drain, then installs through an external rollback-capable helper and restarts automatically
- **Hot/cold grouping** — recent sessions at top, old idle ones behind a configurable day divider
- **Archive / restore** — hide sessions from the list without deleting them; restore from the collapsible drawer at the bottom of the sidebar
- **Analytics dashboard** — activity heatmap, project combo chart (duration + turns + sessions), 24-hour through all-time token and estimated-credit rollups by model, project, and session, tool call breakdown, model distribution, and Codex stats cohort switching, shown when no session is selected
- **Transparent Codex credit estimates** — session and dashboard summaries apply the published per-million-token Codex Standard-mode rate card to fresh input, cached input, and output tokens, show pricing coverage, leave unpublished model aliases unpriced, and explain that reasoning tokens are already billed as output rather than through a separate effort multiplier; Fast-mode multipliers are not guessed because stored telemetry does not identify that mode
- **Context window pie chart** — per-session donut chart showing context window composition (system prompt, user messages, assistant messages, tool calls, tool results, free capacity)
- **Environment banner** — global config overview on the dashboard home page showing active model, MCP servers, skills, and plugins with color-coded chips
- **Session config** — per-session provider metadata: source, model, reasoning effort, sandbox policy, approval mode, skills, plugins, and MCP servers where available

## Quick Start

### Prerequisites

- **Node.js 18+** — `node --version` to check
- **.NET 10 SDK** — optional; required only to build or publish the native Windows/macOS frontend
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

### Native Windows and macOS frontend

The native frontend uses a real operating-system PTY terminal view attached
through a small console bridge to persistent PTYs owned by the dashboard service.
Windows runs the service and Codex in WSL2; macOS runs both locally.
Its Avalonia shell adds push-driven sessions, multi-project and archived search,
rich previews, interactive cohort analytics, latest-prompt navigation, context
composition, Codex subagent timelines, desktop shortcuts, provider/quota health,
styles, and text resizing.
Closing the native UI leaves Codex running; reopening it reattaches with recent
scrollback. A private loopback service is started automatically when needed.

```bash
npm run native:test
npm run native:build
npm run native:publish
```

Self-contained artifacts are published under `native/artifacts/win-x64/`,
`native/artifacts/osx-x64/`, and `native/artifacts/osx-arm64/`. See
`native/README.md` for platform prerequisites and packaging details.

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
| `CODEX_BIN` | `—` | Override Codex executable discovery; otherwise checks `~/.local/bin`, PATH, Homebrew, and nvm locations |
| `PATH` | `—` | Inherited executable search path; native macOS startup also checks Homebrew and nvm locations explicitly |
| `HOME` | `—` | User home used for Codex, local installs, and nvm discovery |
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
  server/providers/codex/executable.js Resolves Codex for desktop processes that do not inherit a login-shell PATH.
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

native/
  native/CodexNative/MainWindow.axaml.cs           Cross-platform native dashboard shell, persistent Codex tabs, direct local shell tabs, push telemetry, cohort analytics, latest-prompt navigation, search, and preferences.
  native/CodexNative/MainWindow.axaml              Native dashboard layout with theme-aware control chrome and the in-app pixel C identity.
  native/CodexNative/Assets/codex-native-icon.png  Transparent generated pixel-art C used by the native dashboard header.
  native/CodexNative/Assets/codex-native-icon.ico  Multi-resolution Windows executable and title-bar icon bundle.
  native/CodexNative/DashboardApiClient.cs         Typed localhost client for sessions, repos, stats, context, configuration, rename, and archive metadata.
  native/CodexNative/DashboardTheme.cs             Native equivalents of the browser dashboard themes and text-size choices.
  native/CodexNative/DashboardServiceManager.cs    Starts the local ui-my-cli service in WSL2 or macOS when port 7575 is unavailable.
  native/CodexNative.Core/NativeLaunchBuilder.cs   Validated launch specifications for the loopback terminal bridge, local shells, and private Windows/macOS service.
  native/CodexNative.TerminalHost/Program.cs       Cross-platform console companion for persistent server-terminal bridging and Windows WSL startup.
  native/CodexNative.TerminalHost/TerminalBridge.cs Bidirectional console/WebSocket bridge that lets native terminal views reattach to persistent server PTYs.
  native/CodexNative.Core/NativePlatform.cs        Explicit Windows, macOS, and Linux native runtime profile and artifact naming.
  native/CodexNative.Core/ExecutableResolver.cs    Validated Node.js and login-shell discovery without user-controlled shell interpolation.
  native/CodexNative.Core/DashboardRepositoryLocator.cs Finds a valid ui-my-cli checkout from explicit configuration, app location, or conventional home paths.
  native/CodexNative.Core/DashboardApiCompatibility.cs Explicit native-client/server API compatibility policy, including the legacy unversioned v1 service shape.
  native/CodexNative.Core/GitHubReleaseClient.cs   Selects a newer stable GitHub Release and its exact platform archive/checksum through trusted HTTPS URLs.
  native/CodexNative.Core/NativeUpdatePackage.cs   Downloads bounded release assets, verifies SHA-256, and rejects traversal, links, or incomplete native payloads.
  native/CodexNative.Core/NativeInstallRequest.cs  Validated structured update handoff arguments and installed-app layout resolution.
  native/CodexNative/NativeUpdateService.cs        Native release check, verified staging, and external updater launch orchestration.
  native/CodexNative.Updater/Program.cs            Out-of-process atomic installation, rollback, and native-app restart helper.
  native/CodexNative/DashboardStatusFeed.cs        Reconnecting Codex status-feed client for push-driven native session updates and rekey events.
  native/CodexNative/AnalyticsControls.cs          Animated, hoverable native charts for token activity, heatmaps, project trends, segmented token bars, and context composition.
  native/CodexNative/SessionPreviewControl.cs      Rich native session summary with conversation history, context composition, model changes, and Codex subagent timelines.
  native/CodexNative/DashboardModels.cs            Typed Codex dashboard, context, analytics, conversation, rate-limit, and subagent payload models.
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

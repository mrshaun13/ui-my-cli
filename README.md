# Agent Dashboard

A browser dashboard for managing multiple local headless-agent sessions across Codex and Devin, plus a browser-free native frontend for Windows and macOS. Both surfaces share persistent server PTYs, live status, analytics, search, and session metadata; the native surface renders terminals through an Avalonia PTY view and can reattach after the UI exits.

## Features

- **Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds
- **Provider switch** — top-level Codex / Devin toggle in the browser and native Agent selector; sessions, repo filters, tabs, stats, archives, and terminals are scoped to the selected provider on both surfaces
- **Native Windows and macOS frontend (development preview)** — Avalonia dashboard with a persistent Agent provider switcher (`/api/providers`), provider-scoped REST/WebSocket/tabs/session actions, push updates, deferred crash-safe conversation search, a compact functional project/age/visibility filter, actionable rich previews, responsive header and pane sizing, theme-aware control chrome and pane scrollbars, a custom pixel-art app identity, a rich compact session rail, a searchable agent-or-local-shell project launcher, automatic terminal-bridge reconnect, toggleable keyboard-accessible cohort analytics (Codex credit rollups only when Codex is selected), latest-prompt navigation, context composition, Codex subagent timelines, keyboard shortcuts, provider/quota health, and persistent provider terminal reattachment; the current desktop package still requires a prepared local ui-my-cli checkout and is not a standalone distribution, while macOS signing, notarization, and production updater distribution remain incomplete and macOS must be treated as experimental
- **Real terminals** — xterm.js + node-pty: identical to running the selected provider CLI in your shell (`codex resume <id>` or `devin --resume <id>`)
- **Native terminal selection** — plain drag selects text even when an agent TUI enables mouse reporting; `Ctrl+C` copies on Windows/Linux, `Cmd+C` copies on macOS, macOS `Ctrl+C` remains SIGINT, and `Alt`+drag sends raw mouse input to the TUI
- **Click to switch** — click any agent in the sidebar to attach its live terminal; switching is instant with scrollback preserved
- **New session** — floating "+" button in the sidebar lets you start a new Codex or Devin session in any previously-used repo; the terminal opens automatically
- **Session preview** — click the status badge to open a read-only view of any session's chat history without spawning a PTY
- **Inline rename** — double-click any session title to rename it (native constrained views compact multiline and long titles without changing the saved title; native Codex titles are written to Codex state so CLI, VS Code, and this dashboard stay aligned; external headless titles use dashboard metadata)
- **Needs-your-input filter** — one click to show only agents waiting for a reply
- **Project filter** — compact count-labelled project selection replaces the unbounded native pill wall; selection persists across reloads
- **Persistent native terminals** — provider-scoped PTYs stay in the independent dashboard service when the desktop UI closes; reopening the native app reattaches with buffered scrollback. On macOS the private service is launched through `nohup`, window close hides to the menu bar, and the menu-bar icon can reopen, reconnect, stop an idle app-managed service, or quit
- **Instant Adaptive switching** — compatible native Codex PTYs stay connected through one app-server control plane while each pane independently switches between native Adaptive routing and direct TUI prompting without restarting or replaying the terminal; existing direct or fallback PTYs stay running and report Adaptive as unavailable instead of being restarted or migrated
- **Durable blank terminals and live context** — newly opened Codex tabs remain available until their first prompt persists the thread, while open native inspectors follow model, reasoning-effort, and context changes from manual `/model` selection or Adaptive routing
- **Project-root-safe native sessions** — each new Codex TUI receives the directory selected in the native chooser as an explicit working root, including when it connects through the shared app-server control plane
- **Local native voice-to-text** — each native terminal has a microphone control that captures through a dedicated cross-platform audio helper, trims speech with Silero VAD, transcribes locally with Whisper base.en, and inserts the result into either terminal input or the initiating pane's Adaptive composer without auto-submitting
- **Verified native updates** — checks stable GitHub Releases for the current OS/architecture, verifies exact size and SHA-256, waits for active provider sessions and local shells to drain, then installs through an external rollback-capable helper and restarts automatically
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
Windows runs the service and provider CLIs in WSL2; macOS runs both locally.
Its Avalonia shell adds an Agent provider switcher backed by `/api/providers`,
provider-scoped sessions/tabs/actions, push-driven updates, multi-project and
archived search, rich previews, interactive cohort analytics (Codex credit
rollups only on Codex), latest-prompt navigation, context composition, Codex
subagent timelines, desktop shortcuts, provider/quota health, styles, and text
resizing.
Closing the native UI leaves provider PTYs running; reopening it reattaches
with recent scrollback. A private loopback service is started automatically when
needed. On macOS the service is launched through `nohup`, window close hides to
the menu bar, and a ready local checkout with installed Node dependencies is
preferred over a stale configured path.

```bash
npm run native:test
npm run native:build
npm run native:publish
```

Self-contained artifacts are published under `native/artifacts/win-x64/`,
`native/artifacts/osx-x64/`, and `native/artifacts/osx-arm64/`. See
`native/README.md` for platform prerequisites and packaging details.

Versioned release downloads are published in
[GitHub Releases](https://github.com/mrshaun13/ui-my-cli/releases) as
`CodexNative-v<version>-win-x64.zip`,
`CodexNative-v<version>-osx-x64.zip`, and
`CodexNative-v<version>-osx-arm64.zip`, each with a SHA-256 manifest. Pull
request workflow artifacts use the same unambiguous names but are temporary
validation outputs rather than stable releases.

The Windows ZIP is a portable application. After verifying its SHA-256, extract
the complete archive to `%LOCALAPPDATA%\Programs\CodexNative`, keep all four
executables together, and run or pin `CodexNative.exe` from that location. Do
not install it on the Desktop, in Downloads, or under OneDrive/network sync:
the in-place updater needs to atomically replace the installation directory.
Because the current binaries are unsigned, Windows users must verify the
GitHub origin and checksum before using each executable's **Properties →
Unblock** control. See `native/README.md` for the complete trust and update
procedure.

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
  server/pty-manager.js        PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients, with Unix spawn-helper executable repair.
  server/codex-control-plane.js Codex control-plane request compatibility and best-effort startup helpers.
  server/pending-session-tracker.js Tracks an unpersisted session until it registers or its terminal exits.
  server/db-path.js            Compatibility exports for legacy db-path imports.
  server/codex-paths.js        Resolves local Codex state paths.
  server/codex-store.js        Codex session adapter.
  server/codex-token-activity.js Builds exact hourly and weekday token activity for every analytics window.
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
  native/CodexNative/App.axaml.cs                  Avalonia application entry; on macOS configures the menu-bar icon for open, service start/reconnect, managed stop, and quit.
  native/CodexNative/MainWindow.axaml.cs           Cross-platform native dashboard shell with Agent provider switcher, provider-scoped persistent session tabs, local voice input, direct local shell tabs, responsive header/pane layout, themed pane scrollbars, macOS hide-to-menu-bar lifecycle, push telemetry, cohort analytics, latest-prompt navigation, search, and preferences.
  native/CodexNative/MainWindow.axaml              Native dashboard layout with Agent provider selector, theme-aware control chrome, and the in-app pixel C identity.
  native/CodexNative/Assets/codex-native-icon.png  Transparent generated pixel-art C used by the native dashboard header.
  native/CodexNative/Assets/codex-native-icon.ico  Multi-resolution Windows executable and title-bar icon bundle.
  native/CodexNative/DashboardApiClient.cs         Typed localhost client that loads `/api/providers` and scopes sessions, terminals, repos, stats, context, configuration, rename, and archive calls to the selected provider.
  native/CodexNative/DashboardTheme.cs             Native equivalents of the browser dashboard themes and text-size choices.
  native/CodexNative/DashboardServiceManager.cs    Starts the local ui-my-cli service in WSL2 or macOS when port 7575 is unavailable; on macOS launches through nohup and can stop an app-owned idle service.
  native/CodexNative.Core/NativeLaunchBuilder.cs   Validated launch specifications for the loopback terminal bridge, local shells, and private Windows/macOS service.
  native/CodexNative.TerminalHost/Program.cs       Cross-platform console companion for persistent server-terminal bridging and Windows WSL startup.
  native/CodexNative.TerminalHost/TerminalBridge.cs Bidirectional console/WebSocket bridge that lets native terminal views reattach to persistent server PTYs.
  native/CodexNative.SpeechHost/SpeechHostApplication.cs On-demand local microphone, Silero VAD, Whisper transcription, and measurable Handy-parity fixture host.
  native/CodexNative/SpeechHostClient.cs           Isolated speech-helper process lifecycle and newline-delimited JSON command/event bridge.
  native/CodexNative.Core/SpeechProtocol.cs        Typed speech-helper lifecycle, capture-health metrics, and word-error-rate parity policy.
  native/CodexNative.Core/NativePlatform.cs        Explicit Windows, macOS, and Linux native runtime profile and artifact naming.
  native/CodexNative.Core/ExecutableResolver.cs    Validated Node.js and login-shell discovery without user-controlled shell interpolation.
  native/CodexNative.Core/DashboardRepositoryLocator.cs Finds a ready ui-my-cli checkout (sources plus express/node-pty) from configuration, app location, or conventional home paths, preferring dependency-ready paths over stale configured ones.
  native/CodexNative.Core/DashboardApiCompatibility.cs Exact native-client/server API compatibility policy that rejects stale services with incomplete analytics contracts.
  native/CodexNative.Core/DashboardServicePorts.cs Bounded private-service port policy used to bypass incompatible or orphaned loopback services safely.
  native/CodexNative.Core/TerminalPaneLayoutMath.cs Pure layout math for fitting and resizing horizontally scrollable native terminal panes to the viewport.
  native/CodexNative.Core/TokenChartMath.cs        Shared-scale chart math that keeps native input/output token comparisons proportional.
  native/CodexNative.Core/GitHubReleaseClient.cs   Selects a newer stable GitHub Release and its exact platform archive/checksum through trusted HTTPS URLs.
  native/CodexNative.Core/NativeUpdatePackage.cs   Downloads bounded release assets, verifies SHA-256, and rejects traversal, links, or incomplete native payloads.
  native/CodexNative.Core/NativeInstallRequest.cs  Validated structured update handoff arguments and installed-app layout resolution.
  native/CodexNative/NativeUpdateService.cs        Native release check, verified staging, and external updater launch orchestration.
  native/CodexNative.Updater/Program.cs            Out-of-process atomic installation, rollback, and native-app restart helper.
  native/CodexNative/DashboardStatusFeed.cs        Reconnecting provider-scoped status-feed client for push-driven native session, rekey, and pending-terminal expiry events.
  native/CodexNative/AnalyticsControls.cs          Animated, hoverable native charts for token activity, heatmaps, project trends, segmented token bars, and context composition.
  native/CodexNative/SessionPreviewControl.cs      Rich native session summary with provider-scoped conversation history, context composition, model changes, and Codex subagent timelines.
  native/CodexNative/DashboardModels.cs            Typed multi-provider dashboard, context, analytics, conversation, rate-limit, provider-catalog, and subagent payload models.
  native/CodexNative/NativeSettings.cs             Persisted native preferences including selected provider, pane layouts, and per-tab provider identity.
```

### WebSocket Protocol

**`/ws/:providerId/terminal/:sessionId`** — PTY bridge

- Optional query: `cols`, `rows`, and `controlPlane=1`; legacy `adaptive=1` also requests the Codex control-plane transport
- Client → Server: `{ type: "input", data }` | `{ type: "resize", cols, rows }`
- Server → Client: `{ type: "output", data }` | `{ type: "exit", exitCode }`

**`/ws/:providerId/status`** — live session status feed (server-push only)

- Server → Client: `{ type: "sessions", data: Session[] }` every 3 seconds
- Server → Client: `{ type: "latest-prompt", data }` on DB write events
- Server → Client: `{ type: "rekey", tempKey, realId }` when a pending session persists
- Server → Client: `{ type: "pending-expired", tempKey }` when a pending terminal exits before persistence

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

- `vite` pinned to `6.4.3` in `client/package.json` (fixes the WebSocket `fetchModule` and `.map` traversal advisories in earlier 6.x).
- `postcss` pinned to `8.5.12` via `client/package.json#overrides` (fixes the `</style>` XSS advisory). The `overrides` block is scoped to the `client/` install root — `client/` runs its own `npm install` (its own lockfile) per the root `postinstall` script, which is what makes the override take effect there.

Run `npm audit` from both the repo root and `client/` after any dependency change to confirm zero advisories. When a future advisory clears, you can unpin to rejoin the floated range.

## License

MIT

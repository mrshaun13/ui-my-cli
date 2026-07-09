# Architecture

## Overview

The browser dashboard server is a single Node.js process (Express + ws) with provider adapters for Codex and Devin. Each provider owns its local state reader, archive/restore behavior, stats adapter, and PTY command builder. The React client exposes a hard provider switch so Codex and Devin sessions never mix in one dashboard view. The Codex provider can also read transcript-pipeline headless ledgers that explicitly record `runtime_metadata.agent_id = "codex"`; those external runs stay read-only and are surfaced as transcript-pipeline headless sessions. The cross-platform native frontend uses Avalonia for the dashboard and a native PTY terminal control for rendering. Its console bridge attaches Codex tabs to the same buffered server PTYs as the browser, so sessions can outlive either UI. Windows keeps Codex and project files in WSL2; macOS uses the local Node service and Codex state, recovers a ready ui-my-cli checkout with installed Node dependencies when a configured path is stale, launches its private service through `nohup`, and exposes a menu-bar lifecycle for hide/reopen/stop/quit. The Node PTY manager self-heals a missing executable bit on node-pty's Unix spawn-helper before spawn. Direct login-shell tabs run in validated project paths and end when their tab or the application closes. Native updates consume platform-specific GitHub Release archives, verify their SHA-256 manifests, stage them outside the installation, wait for active work to drain, and hand replacement/restart to an external helper with rollback.

## Data Flow

```
Codex CLI / VS Code  →  ~/.codex state DB + rollout JSONL  →  Codex provider adapter  →  WebSocket push  →  React client
transcript-pipeline Codex headless ledger  →  data/headless-sessions status/events files  →  Codex provider external-read adapter  →  React client
Devin CLI  →  Devin sessions.db + dashboard.db  →  Devin provider adapter  →  WebSocket push  →  React client
Browser  →  xterm.js keystrokes  →  provider-scoped WebSocket  →  node-pty  →  selected provider resume command
Windows native app  →  Avalonia terminal control  →  ConPTY  →  console bridge  →  WebSocket  →  persistent WSL2 PTY  →  Codex CLI
Windows native app  →  Avalonia terminal control  →  ConPTY  →  validated WSL2 launch  →  Ubuntu login shell
Windows native dashboard controls  →  localhost provider API  →  session/context/stats readers  →  Codex state in WSL2
macOS native app  →  Avalonia terminal control  →  local PTY  →  console bridge  →  WebSocket  →  persistent macOS PTY  →  Codex CLI
macOS native app  →  Avalonia terminal control  →  validated project path  →  local login shell
```

## Server Files

| File | Description |
| --- | --- |
| `server/index.js` | Agent Dashboard — Express server with WebSocket support. |
| `server/sessions.js` | Codex compatibility session facade for legacy imports. |
| `server/stats.js` | Codex compatibility stats facade for legacy imports. |
| `server/pty-manager.js` | PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients, with Unix spawn-helper executable repair. |
| `server/db-path.js` | Compatibility exports for legacy db-path imports. |
| `server/codex-paths.js` | Resolves local Codex state paths. |
| `server/codex-store.js` | Codex session adapter. |
| `server/codex-token-activity.js` | Builds exact hourly and weekday token activity for every analytics window. |
| `server/dashboard-store.js` | Dashboard-owned metadata for external/headless sessions and other UI state. |
| `server/transcript-headless-store.js` | Read-only adapter for transcript-pipeline headless session ledgers. |
| `server/providers/index.js` | Provider registry for local headless-agent adapters. |
| `server/providers/codex/index.js` | Codex provider adapter wiring local Codex state into the dashboard contract. |
| `server/providers/codex/executable.js` | Resolves Codex for desktop processes that do not inherit a login-shell PATH. |
| `server/providers/devin/index.js` | Devin provider adapter wiring legacy Devin CLI state into the dashboard contract. |
| `server/providers/devin/paths.js` | Resolves Devin-related database paths across platforms. |

## Client Files

| File | Description |
| --- | --- |
| `client/src/App.jsx` |  |
| `client/src/components/Sidebar.jsx` | Sidebar — left panel listing all sessions for the selected provider. |
| `client/src/components/AgentCard.jsx` | AgentCard — one row in the sidebar representing a provider session. |
| `client/src/components/Terminal.jsx` | Terminal — xterm.js terminal connected to the server PTY via WebSocket. |
| `client/src/components/ControlBar.jsx` | ControlBar — always-visible context strip at the bottom of the UI. |
| `client/src/components/DashboardSplash.jsx` | DashboardSplash — shown when no session is selected. |
| `client/src/components/SessionPreview.jsx` | SessionPreview — read-only session detail panel. |
| `client/src/hooks/useStatusFeed.js` | useStatusFeed — subscribes to the selected provider's status WebSocket |

## Native Windows and macOS Frontend Files

| File | Description |
| --- | --- |
| `native/CodexNative/App.axaml.cs` | Avalonia application entry; on macOS configures the menu-bar icon for open, service start/reconnect, managed stop, and quit. |
| `native/CodexNative/MainWindow.axaml.cs` | Cross-platform native dashboard shell, persistent Codex tabs, direct local shell tabs, macOS hide-to-menu-bar lifecycle, push telemetry, cohort analytics, latest-prompt navigation, search, and preferences. |
| `native/CodexNative/MainWindow.axaml` | Native dashboard layout with theme-aware control chrome and the in-app pixel C identity. |
| `native/CodexNative/Assets/codex-native-icon.png` | Transparent generated pixel-art C used by the native dashboard header. |
| `native/CodexNative/Assets/codex-native-icon.ico` | Multi-resolution Windows executable and title-bar icon bundle. |
| `native/CodexNative/DashboardApiClient.cs` | Typed localhost client for sessions, repos, stats, context, configuration, rename, and archive metadata. |
| `native/CodexNative/DashboardTheme.cs` | Native equivalents of the browser dashboard themes and text-size choices. |
| `native/CodexNative/DashboardServiceManager.cs` | Starts the local ui-my-cli service in WSL2 or macOS when port 7575 is unavailable; on macOS launches through nohup and can stop an app-owned idle service. |
| `native/CodexNative.Core/NativeLaunchBuilder.cs` | Validated launch specifications for the loopback terminal bridge, local shells, and private Windows/macOS service. |
| `native/CodexNative.TerminalHost/Program.cs` | Cross-platform console companion for persistent server-terminal bridging and Windows WSL startup. |
| `native/CodexNative.TerminalHost/TerminalBridge.cs` | Bidirectional console/WebSocket bridge that lets native terminal views reattach to persistent server PTYs. |
| `native/CodexNative.Core/NativePlatform.cs` | Explicit Windows, macOS, and Linux native runtime profile and artifact naming. |
| `native/CodexNative.Core/ExecutableResolver.cs` | Validated Node.js and login-shell discovery without user-controlled shell interpolation. |
| `native/CodexNative.Core/DashboardRepositoryLocator.cs` | Finds a ready ui-my-cli checkout (sources plus express/node-pty) from configuration, app location, or conventional home paths, preferring dependency-ready paths over stale configured ones. |
| `native/CodexNative.Core/DashboardApiCompatibility.cs` | Exact native-client/server API compatibility policy that rejects stale services with incomplete analytics contracts. |
| `native/CodexNative.Core/DashboardServicePorts.cs` | Bounded private-service port policy used to bypass incompatible or orphaned loopback services safely. |
| `native/CodexNative.Core/TokenChartMath.cs` | Shared-scale chart math that keeps native input/output token comparisons proportional. |
| `native/CodexNative.Core/GitHubReleaseClient.cs` | Selects a newer stable GitHub Release and its exact platform archive/checksum through trusted HTTPS URLs. |
| `native/CodexNative.Core/NativeUpdatePackage.cs` | Downloads bounded release assets, verifies SHA-256, and rejects traversal, links, or incomplete native payloads. |
| `native/CodexNative.Core/NativeInstallRequest.cs` | Validated structured update handoff arguments and installed-app layout resolution. |
| `native/CodexNative/NativeUpdateService.cs` | Native release check, verified staging, and external updater launch orchestration. |
| `native/CodexNative.Updater/Program.cs` | Out-of-process atomic installation, rollback, and native-app restart helper. |
| `native/CodexNative/DashboardStatusFeed.cs` | Reconnecting Codex status-feed client for push-driven native session updates and rekey events. |
| `native/CodexNative/AnalyticsControls.cs` | Animated, hoverable native charts for token activity, heatmaps, project trends, segmented token bars, and context composition. |
| `native/CodexNative/SessionPreviewControl.cs` | Rich native session summary with conversation history, context composition, model changes, and Codex subagent timelines. |
| `native/CodexNative/DashboardModels.cs` | Typed Codex dashboard, context, analytics, conversation, rate-limit, and subagent payload models. |

## Server Dependencies

| Package | Version |
| --- | --- |
| `better-sqlite3` | `^9.4.3` |
| `cors` | `^2.8.5` |
| `express` | `^4.18.3` |
| `node-pty` | `^1.0.0` |
| `ws` | `^8.16.0` |

## Client Dependencies

| Package | Version |
| --- | --- |
| `@xterm/addon-fit` | `^0.10.0` |
| `@xterm/addon-web-links` | `^0.11.0` |
| `@xterm/xterm` | `^5.5.0` |
| `react` | `^19.0.0` |
| `react-dom` | `^19.0.0` |

## Status State Machine

Each provider adapter returns one of four status values. Codex derives status
from local thread metadata and rollout JSONL; Devin derives status from recent
message_nodes in Devin `sessions.db`.

| Status | Condition |
| --- | --- |
| `active` | Codex activity within the last 60 seconds. |
| `question` | Latest assistant text ends with `?`, indicating a likely prompt for your input. |
| `finished` | Recent non-idle session with no detected question. |
| `idle` | No activity for more than 10 minutes. |

The Codex logic lives in `server/codex-store.js`; the Devin logic lives in
`server/providers/devin/store.js`.

## Storage Model

| Data | Location | Access |
|------|----------|--------|
| Session metadata | Codex `~/.codex/state_*.sqlite` | Read-only |
| Message history and tool events | Codex rollout JSONL under `~/.codex/sessions/` | Read-only |
| Archive state | Codex CLI `archive` / `unarchive` commands | Codex-owned |
| Transcript-pipeline Codex headless ledgers | `TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR` or `~/git/ai-tell-my-story/transcript-pipeline/data/headless-sessions` | Read-only |
| Dashboard title overrides and external headless hide state | `~/.codex/ui-my-cli-dashboard.db` | Read-write (dashboard only) |
| Devin session metadata/history | Devin `sessions.db` | Read-only except title rename |
| Devin archive state | Devin dashboard metadata DB next to `sessions.db` | Read-write (dashboard only) |
| User preferences (repo filters, cold-days threshold) | Browser `localStorage` | Client-side only; never sent to server |

## WebSocket Architecture

The server maintains two WebSocket namespaces:

1. **PTY bridge** (`/ws/:providerId/terminal/:id`) — One `node-pty` process per provider/session ID.
   Multiple browser tabs can attach to the same PTY simultaneously and share
   the same terminal stream. A rolling 256 KB scrollback buffer replays
   terminal history to new connections.

2. **Status feed** (`/ws/:providerId/status`) — Server-push only. Sends the full session
   list every 3 seconds. Each provider watches its own local state files
   (debounced 120 ms) to deliver updates without waiting for the next poll interval.

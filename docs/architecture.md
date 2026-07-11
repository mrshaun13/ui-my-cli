# Architecture

## Overview

The browser dashboard server is a single Node.js process (Express + ws) with provider adapters for Codex and Devin. Each provider owns its local state reader, archive/restore behavior, stats adapter, and PTY command builder. The React client and the Avalonia native shell each expose a hard provider switch so Codex and Devin sessions never mix in one dashboard view; both load the catalog from `/api/providers` and scope list/search/stats/archive/PTY traffic to the selected provider. The Codex provider can also read transcript-pipeline headless ledgers that explicitly record `runtime_metadata.agent_id = "codex"`; those external runs stay read-only and are surfaced as transcript-pipeline headless sessions. New browser sessions start on a temporary PTY key, then re-key only after exact Codex originator correlation or the spawned Devin process log identifies its own persisted session; every live pending PTY survives client detachment until its process exits or the user explicitly cancels it. A collision keeps separate canonical metadata and temporary terminal transport identities so neither browser terminal is discarded. Synthetic Codex context envelopes are excluded from user-prompt metadata. New session titles are limited to 160 characters, while legacy oversized titles and native prompt previews are normalized to bounded single-line display text. The cross-platform native frontend uses Avalonia for the dashboard and a native PTY terminal control for rendering. Its console bridge attaches provider-scoped session tabs to the same buffered server PTYs as the browser, so sessions can outlive either UI. Tabs and previews retain their provider identity across switches; native settings persist the selected provider and each pane tab's provider. A separate on-demand speech helper owns microphone capture, Silero VAD, and local Whisper transcription so audio and model faults cannot destabilize the dashboard process. Windows keeps provider CLIs and project files in WSL2; macOS uses the local Node service and provider state, recovers a ready ui-my-cli checkout with installed Node dependencies when a configured path is stale, launches its private service through `nohup`, and exposes a menu-bar lifecycle for hide/reopen/stop/quit. Non-Codex analytics omit Codex-only credit rollups and pricing telemetry. The Node PTY manager self-heals a missing executable bit on node-pty's Unix spawn-helper before spawn. Direct login-shell tabs run in validated project paths and end when their tab or the application closes. Native updates cache and ETag-revalidate platform release metadata, report rate-limit reset times, verify their SHA-256 manifests, stage outside the installation, require an authenticated app-owned private service instead of stopping a shared port-7575 service, wait at most two minutes for dashboard-tracked active sessions and local shells to drain, retain quiet visible or archived Codex turns, unresolved Devin tool calls, and transcript-pipeline headless runs as blockers while explicitly in flight, expire abandoned in-flight work after 24 hours, and hand replacement to an external helper with the exact owned private-service PID, loopback endpoint, and instance identity. The helper uses an authenticated readiness contract to revalidate that same service has no active provider sessions or PTYs immediately before requesting graceful shutdown, holds a target-specific lock through replacement and rollback, transfers the lock to the replacement through framework initialization and its ready handshake, leaves unrelated processes untouched, verifies the installed version, restores the previous install before cleaning failed staging data, and reports the final result once on the next launch.

## Data Flow

```
Codex CLI / VS Code  →  ~/.codex state DB + rollout JSONL  →  Codex provider adapter  →  WebSocket push  →  React client / native app
transcript-pipeline Codex headless ledger  →  data/headless-sessions status/events files  →  Codex provider external-read adapter  →  React client / native app
Devin CLI  →  Devin sessions.db + dashboard.db  →  Devin provider adapter  →  WebSocket push  →  React client / native app
Browser  →  xterm.js keystrokes  →  provider-scoped WebSocket  →  node-pty  →  selected provider resume command
New-session POST  →  temporary PTY  →  exact Codex originator / Devin process correlation  →  re-keyed provider session
Native app Agent selector  →  GET /api/providers  →  provider-scoped /api/:providerId/* and /ws/:providerId/*
Windows native app  →  Avalonia terminal control  →  ConPTY  →  console bridge  →  provider-scoped WebSocket  →  persistent WSL2 PTY  →  selected provider CLI
Windows native app  →  Avalonia terminal control  →  ConPTY  →  validated WSL2 launch  →  Ubuntu login shell
Windows native dashboard controls  →  localhost /api/:providerId  →  session/context/stats readers  →  selected provider state in WSL2
Native microphone button  →  on-demand speech helper  →  16 kHz mono capture  →  Silero VAD  →  local Whisper base.en  →  terminal input or Adaptive composer
macOS native app  →  Avalonia terminal control  →  local PTY  →  console bridge  →  provider-scoped WebSocket  →  persistent macOS PTY  →  selected provider CLI
macOS native app  →  Avalonia terminal control  →  validated project path  →  local login shell
```

## Server Files

| File | Description |
| --- | --- |
| `server/index.js` | Express/WebSocket dashboard API with provider routing, durable renames, pending-session lifecycle, and authenticated native update control. |
| `server/sessions.js` | Codex compatibility session facade for legacy imports. |
| `server/stats.js` | Codex compatibility stats facade for legacy imports. |
| `server/pty-manager.js` | Persistent provider PTYs with detached-pending retention, collision-safe transport identity, buffered reattachment, and spawn-helper repair. |
| `server/codex-control-plane.js` | Codex control-plane request compatibility and best-effort startup helpers. |
| `server/db-path.js` | Compatibility exports for legacy db-path imports. |
| `server/codex-paths.js` | Resolves local Codex state paths. |
| `server/codex-store.js` | Codex state adapter with safe prompt metadata, explicit in-flight detection, native title resolution, and archive behavior. |
| `server/codex-token-activity.js` | Builds exact hourly and weekday token activity for every analytics window. |
| `server/dashboard-store.js` | Dashboard-owned metadata for external/headless sessions and other UI state. |
| `server/transcript-headless-store.js` | Read-only transcript-pipeline ledger adapter with safe prompt metadata and in-flight run detection. |
| `server/native-service-control.js` | Constant-time validation of the one-service native update control capability. |
| `server/native-update-activity.js` | Fail-closed all-provider activity snapshot for native update readiness, including archived and explicitly in-flight work. |
| `server/native-update-gate.js` | Serializes session mutations with native shutdown so update readiness cannot race a new mutation. |
| `server/pending-session-lifecycle.js` | Pending-session lifecycle policy for safe re-keying, live-PTY retention through client detachment, exit expiry, and exact provider-owned correlation. |
| `server/session-display-text.js` | Shared bounded session-title formatting and filtering of injected Codex context from user-prompt metadata. |
| `server/providers/index.js` | Provider registry for local headless-agent adapters. |
| `server/providers/codex/index.js` | Codex provider adapter wiring local Codex state into the dashboard contract. |
| `server/providers/codex/executable.js` | Resolves Codex for desktop processes that do not inherit a login-shell PATH. |
| `server/providers/codex/rename.js` | Persists native Codex titles through the app-server and keeps external headless titles in dashboard metadata. |
| `server/providers/devin/index.js` | Devin provider adapter wiring legacy Devin CLI state into the dashboard contract. |
| `server/providers/devin/paths.js` | Resolves Devin-related database paths across platforms. |
| `server/providers/devin/store.js` | Devin state adapter with process-owned pending-session correlation, unresolved-tool activity detection, titles, and archive metadata. |

## Client Files

| File | Description |
| --- | --- |
| `client/src/App.jsx` | Browser dashboard shell coordinating provider sessions, canonical/transport tab identities, and durable title updates. |
| `client/src/components/Sidebar.jsx` | Sidebar — left panel listing all sessions for the selected provider. |
| `client/src/components/AgentCard.jsx` | Sidebar session row with validated canonical rename handling. |
| `client/src/components/Terminal.jsx` | Terminal — xterm.js terminal connected to the server PTY via WebSocket. |
| `client/src/components/ControlBar.jsx` | Selected-session context strip with validated canonical rename handling. |
| `client/src/components/DashboardSplash.jsx` | DashboardSplash — shown when no session is selected. |
| `client/src/components/SessionPreview.jsx` | Read-only session detail panel with validated canonical rename handling. |
| `client/src/components/TabBar.jsx` | Browser tab strip that preserves separate pending transport tabs during canonical-session collisions. |
| `client/src/hooks/useStatusFeed.js` | Provider status WebSocket with pending re-key/expiry handling and stale-title reconciliation. |
| `client/src/lib/sessionTitles.js` | Shared browser title validation, canonical rename response handling, and stale-feed reconciliation. |
| `client/src/lib/tabState.js` | Separates canonical session identity from temporary terminal transport identity during pending-session collisions. |

## Native Windows and macOS Frontend Files

| File | Description |
| --- | --- |
| `native/CodexNative/App.axaml.cs` | Avalonia application entry; on macOS configures the menu-bar icon for open, service start/reconnect, managed stop, and quit. |
| `native/CodexNative/MainWindow.axaml.cs` | Cross-platform native dashboard shell with Agent provider switcher, provider-scoped persistent session tabs, selection-first terminal mouse handling, platform-safe clipboard actions, local voice input, direct local shell tabs, responsive layout, macOS hide-to-menu-bar lifecycle, analytics, search, and preferences. |
| `native/CodexNative/MainWindow.axaml` | Native dashboard layout with Agent provider selector, theme-aware control chrome, and the in-app pixel C identity. |
| `native/CodexNative/Assets/codex-native-icon.png` | Transparent generated pixel-art C used by the native dashboard header. |
| `native/CodexNative/Assets/codex-native-icon.ico` | Multi-resolution Windows executable and title-bar icon bundle. |
| `native/CodexNative/DashboardApiClient.cs` | Typed localhost client for provider-scoped session APIs plus authenticated native-service compatibility, update-readiness, and shutdown calls. |
| `native/CodexNative/DashboardTheme.cs` | Native equivalents of the browser dashboard themes and text-size choices. |
| `native/CodexNative/DashboardServiceManager.cs` | Starts, identifies, persists, and safely re-adopts an app-owned private ui-my-cli service in WSL2 or macOS without claiming a shared port-7575 service. |
| `native/CodexNative.Core/DashboardServiceOwnership.cs` | Validated private-service PID, start time, port, instance identity, and control capability used for safe re-adoption and update handoff. |
| `native/CodexNative.Core/NativeLaunchBuilder.cs` | Validated launch specifications for authenticated loopback terminal bridges, local shells, and private Windows/macOS services. |
| `native/CodexNative.TerminalHost/Program.cs` | Cross-platform console companion that forwards private-service capability only to its authenticated persistent terminal bridge. |
| `native/CodexNative.TerminalHost/TerminalBridge.cs` | Bidirectional console/WebSocket bridge that lets native terminal views reattach to persistent server PTYs. |
| `native/CodexNative.SpeechHost/SpeechHostApplication.cs` | On-demand local microphone, Silero VAD, Whisper transcription, and measurable Handy-parity fixture host. |
| `native/CodexNative/SpeechHostClient.cs` | Isolated speech-helper process lifecycle and newline-delimited JSON command/event bridge. |
| `native/CodexNative.Core/SpeechProtocol.cs` | Typed speech-helper lifecycle, capture-health metrics, and word-error-rate parity policy. |
| `native/CodexNative.Core/NativePlatform.cs` | Explicit Windows, macOS, and Linux native runtime profile and artifact naming. |
| `native/CodexNative.Core/ExecutableResolver.cs` | Validated Node.js and login-shell discovery without user-controlled shell interpolation. |
| `native/CodexNative.Core/DashboardRepositoryLocator.cs` | Finds a ready ui-my-cli checkout (sources plus express/node-pty) from configuration, app location, or conventional home paths, preferring dependency-ready paths over stale configured ones. |
| `native/CodexNative.Core/DashboardApiCompatibility.cs` | Exact native-client/server API policy that requires the v6 authenticated, fail-closed update-readiness contract. |
| `native/CodexNative.Core/DashboardServicePorts.cs` | Bounded private-service port policy used to bypass incompatible or orphaned loopback services safely. |
| `native/CodexNative.Core/TerminalPaneLayoutMath.cs` | Pure layout math for fitting and resizing horizontally scrollable native terminal panes to the viewport. |
| `native/CodexNative.Core/TokenChartMath.cs` | Shared-scale chart math that keeps native input/output token comparisons proportional. |
| `native/CodexNative.Core/GitHubReleaseClient.cs` | Queries trusted stable GitHub Release metadata with ETag revalidation, rate-limit reset reporting, and opt-in token authentication. |
| `native/CodexNative.Core/NativeUpdatePackage.cs` | Downloads bounded release assets, verifies SHA-256, and rejects traversal, links, or incomplete native payloads. |
| `native/CodexNative.Core/NativeInstallRequest.cs` | Validated update handoff for the exact owned dashboard process, terminal-host processes, control capability, and installed-app layout. |
| `native/CodexNative.Core/NativeInstallProcessPolicy.cs` | Confirms that a candidate terminal host or app process belongs to the current native installation before updater cleanup or restart checks. |
| `native/CodexNative.Core/NativeInstallLock.cs` | Install-scoped exclusive lock that serializes native starts, replacement, rollback, and the authorized post-update restart. |
| `native/CodexNative.Core/NativeDashboardUpdatePolicy.cs` | Fail-closed ownership, activity, and authenticated shutdown policy for handing an exact private dashboard service to the updater. |
| `native/CodexNative.Core/NativeStartupHealthHandshake.cs` | Framework-ready startup handshake used to transfer the install lock to a verified replacement process. |
| `native/CodexNative.Core/NativeUpdateInstallationState.cs` | Tracks post-restart validation without preserving a stale marker that could block future native starts. |
| `native/CodexNative.Core/NativeUpdatePolicy.cs` | Shared updater drain timeout, rollback-backup requirement, and failure aggregation policy. |
| `native/CodexNative.Core/NativeUpdateResultStore.cs` | Persists one bounded updater result for display on the next native launch. |
| `native/CodexNative.Core/SessionDisplayText.cs` | Normalizes and length-bounds native session titles and prompt previews for fixed dashboard layouts. |
| `native/CodexNative.Core/SessionRenameGuard.cs` | Temporarily preserves a successful canonical rename while stale status-feed frames catch up. |
| `native/CodexNative.Core/SessionTitleDisplay.cs` | Compacts oversized legacy session titles only for constrained native display surfaces. |
| `native/CodexNative.Core/TerminalClipboardShortcut.cs` | Maps platform-safe terminal copy, copy-all, and paste shortcuts without taking ordinary shell control keys. |
| `native/CodexNative.Core/TerminalSelectionGeometry.cs` | Maps native terminal pointer coordinates to bounded text cells for selection-first drag handling. |
| `native/CodexNative/NativeUpdateService.cs` | Coalesced cached native release checks with safe ETag recovery, verified staging, and external updater launch orchestration. |
| `native/CodexNative.Updater/Program.cs` | Out-of-process retrying installation, version/startup validation, rollback, result reporting, and native-app restart helper. |
| `native/CodexNative/DashboardStatusFeed.cs` | Reconnecting provider-scoped status-feed client for push-driven native session, rekey, and pending-terminal process-exit events. |
| `native/CodexNative/AnalyticsControls.cs` | Animated, hoverable native charts for token activity, heatmaps, project trends, segmented token bars, and context composition. |
| `native/CodexNative/SessionPreviewControl.cs` | Rich native session summary with provider-scoped conversation history, context composition, model changes, and Codex subagent timelines. |
| `native/CodexNative/DashboardModels.cs` | Typed multi-provider dashboard, bounded session-display, context, analytics, conversation, rate-limit, provider-catalog, and subagent payload models. |
| `native/CodexNative/NativeSettings.cs` | Persisted native preferences plus the private dashboard ownership record needed for exact service re-adoption. |

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
| Session metadata and native titles | Codex `~/.codex/state_*.sqlite` | Read-only except durable title rename through the Codex app-server |
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
   terminal history to new connections. Codex clients can request the shared
   app-server control-plane transport without coupling it to the pane's current
   Adaptive preference. New-session requests use a temporary
   PTY key until the provider safely correlates its first persisted record;
   Codex uses the injected originator marker and Devin reads the persisted
   session ID from the spawned process's own log. A live pending
   terminal remains available through client detachment until it registers,
   exits, or is explicitly canceled.

2. **Status feed** (`/ws/:providerId/status`) — Server-push only. Sends the full session
   list every 3 seconds plus pending-session rekey/expiry and latest-prompt
   events. Each provider watches its own local state files (debounced 120 ms)
   to deliver updates without waiting for the next poll interval.

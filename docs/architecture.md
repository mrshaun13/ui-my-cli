# Architecture

## Overview

The server is a single Node.js process (Express + ws) with provider adapters for Codex and Devin. Each provider owns its local state reader, archive/restore behavior, stats adapter, and PTY command builder. The React client exposes a hard provider switch so Codex and Devin sessions never mix in one dashboard view.

## Data Flow

```
Codex CLI / VS Code  →  ~/.codex state DB + rollout JSONL  →  Codex provider adapter  →  WebSocket push  →  React client
Devin CLI  →  Devin sessions.db + dashboard.db  →  Devin provider adapter  →  WebSocket push  →  React client
Browser  →  xterm.js keystrokes  →  provider-scoped WebSocket  →  node-pty  →  selected provider resume command
```

## Server Files

| File | Description |
| --- | --- |
| `server/index.js` | Agent Dashboard — Express server with WebSocket support. |
| `server/sessions.js` | Codex compatibility session facade for legacy imports. |
| `server/stats.js` | Codex compatibility stats facade for legacy imports. |
| `server/pty-manager.js` | PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients. |
| `server/db-path.js` | Compatibility exports for legacy db-path imports. |
| `server/codex-paths.js` | Resolves local Codex state paths. |
| `server/codex-store.js` | Codex session adapter. |
| `server/dashboard-store.js` | Dashboard-owned metadata for local Codex sessions. |
| `server/providers/index.js` | Provider registry for local headless-agent adapters. |
| `server/providers/codex/index.js` | Codex provider adapter wiring local Codex state into the dashboard contract. |
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
| Dashboard title overrides | `~/.codex/ui-my-cli-dashboard.db` | Read-write (dashboard only) |
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

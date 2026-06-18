# Architecture

## Overview

The server is a single Node.js process (Express + ws) that reads Codex local state from `~/.codex/state_*.sqlite` and rollout JSONL files under `~/.codex/sessions/`, then spawns node-pty processes bridged to browser-based xterm.js terminals. Codex-owned state is treated as read-only except for archive/restore through the Codex CLI.

## Data Flow

```
Codex CLI / VS Code  →  ~/.codex state DB + rollout JSONL  →  server polls every 3s  →  WebSocket push  →  React client
Browser  →  xterm.js keystrokes  →  WebSocket  →  node-pty  →  codex resume <id>
```

## Server Files

| File | Description |
| --- | --- |
| `server/index.js` | Codex Dashboard — Express server with WebSocket support. |
| `server/sessions.js` | Session facade for the dashboard. |
| `server/stats.js` | Stats facade for local Codex sessions. |
| `server/pty-manager.js` | PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients. |
| `server/db-path.js` | Compatibility exports for legacy db-path imports. |
| `server/codex-paths.js` | Resolves local Codex state paths. |
| `server/codex-store.js` | Codex session adapter. |
| `server/dashboard-store.js` | Dashboard-owned metadata for local Codex sessions. |

## Client Files

| File | Description |
| --- | --- |
| `client/src/App.jsx` |  |
| `client/src/components/Sidebar.jsx` | Sidebar — left panel listing all Codex sessions. |
| `client/src/components/AgentCard.jsx` | AgentCard — one row in the sidebar representing a Codex session. |
| `client/src/components/Terminal.jsx` | Terminal — xterm.js terminal connected to the server PTY via WebSocket. |
| `client/src/components/ControlBar.jsx` | ControlBar — always-visible context strip at the bottom of the UI. |
| `client/src/components/DashboardSplash.jsx` | DashboardSplash — shown when no session is selected. |
| `client/src/components/SessionPreview.jsx` | SessionPreview — read-only session detail panel. |
| `client/src/hooks/useStatusFeed.js` | useStatusFeed — subscribes to the server's /ws/status WebSocket |

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

The status adapter in `server/codex-store.js` reads Codex thread metadata
and recent rollout JSONL messages and returns one of four status values:

| Status | Condition |
| --- | --- |
| `active` | Codex activity within the last 60 seconds. |
| `question` | Latest assistant text ends with `?`, indicating a likely prompt for your input. |
| `finished` | Recent non-idle session with no detected question. |
| `idle` | No activity for more than 10 minutes. |

The full logic lives in `server/codex-store.js`.

## Storage Model

| Data | Location | Access |
|------|----------|--------|
| Session metadata | Codex `~/.codex/state_*.sqlite` | Read-only |
| Message history and tool events | Codex rollout JSONL under `~/.codex/sessions/` | Read-only |
| Archive state | Codex CLI `archive` / `unarchive` commands | Codex-owned |
| Dashboard title overrides | `~/.codex/ui-my-cli-dashboard.db` | Read-write (dashboard only) |
| User preferences (repo filters, cold-days threshold) | Browser `localStorage` | Client-side only; never sent to server |

## WebSocket Architecture

The server maintains two WebSocket namespaces:

1. **PTY bridge** (`/ws/terminal/:id`) — One `node-pty` process per session ID.
   Multiple browser tabs can attach to the same PTY simultaneously and share
   the same terminal stream. A rolling 256 KB scrollback buffer replays
   terminal history to new connections.

2. **Status feed** (`/ws/status`) — Server-push only. Sends the full session
   list every 3 seconds. Also watches the Codex state DB, WAL/SHM files, and
   sessions directory (debounced 120 ms) to deliver updates without waiting for
   the next poll interval.

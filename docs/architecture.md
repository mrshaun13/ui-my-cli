# Architecture

## Overview

The server is a single Node.js process (Express + ws) that reads the Devin CLI's SQLite database and spawns node-pty processes bridged to browser-based xterm.js terminals. Session data flows one-way from the CLI database to the dashboard — the only writes back to that database are session title renames.

## Data Flow

```
Devin CLI  →  sessions.db (SQLite)  →  server polls every 3s  →  WebSocket push  →  React client
Browser  →  xterm.js keystrokes  →  WebSocket  →  node-pty  →  devin --resume <id>
```

## Server Files

| File | Description |
| --- | --- |
| `server/index.js` | Devin Dashboard — Express server with WebSocket support. |
| `server/sessions.js` | Sessions module — reads (and selectively writes) the Devin CLI SQLite database. |
| `server/stats.js` | Stats module — computes dashboard analytics from the Devin CLI SQLite DB |
| `server/pty-manager.js` | PTY Manager — spawns and manages node-pty processes bridged to WebSocket clients. |
| `server/db-path.js` | Resolves Devin-related database paths across platforms. |

## Client Files

| File | Description |
| --- | --- |
| `client/src/App.jsx` |  |
| `client/src/components/Sidebar.jsx` | Sidebar — left panel listing all Devin sessions. |
| `client/src/components/AgentCard.jsx` | AgentCard — one row in the sidebar representing a Devin session. |
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

The `deriveStatus()` function in `server/sessions.js` reads the last 5
`message_nodes` rows for a session and returns one of four status values:

| Status | Condition |
| --- | --- |
| `active` | Devin is currently doing something (tool calls in flight, or a tool result arrived recently meaning next turn is imminent) |
| `question` | Devin's last message is text with no tool calls AND it ends with a question — Devin is blocked waiting for an answer |
| `finished` | Devin's last message is text with no tool calls, no question, and nothing has happened for >30s — work is done / paused |
| `idle` | no activity for >10 minutes, or no messages at all |

The full logic (edge cases, timing thresholds) lives in `server/sessions.js`.
This table is extracted verbatim from the function's JSDoc block.

## Storage Model

| Data | Location | Access |
|------|----------|--------|
| Session records, titles, message history | Devin CLI `sessions.db` (SQLite) | Read-only; title renames write to `sessions.title` |
| Archived session IDs | `dashboard.db` (SQLite, same directory as sessions.db) | Read-write (dashboard only) |
| User preferences (repo filters, cold-days threshold) | Browser `localStorage` | Client-side only; never sent to server |

## WebSocket Architecture

The server maintains two WebSocket namespaces:

1. **PTY bridge** (`/ws/terminal/:id`) — One `node-pty` process per session ID.
   Multiple browser tabs can attach to the same PTY simultaneously and share
   the same terminal stream. A rolling 256 KB scrollback buffer replays
   terminal history to new connections.

2. **Status feed** (`/ws/status`) — Server-push only. Sends the full session
   list every 3 seconds. Also watches the SQLite WAL file for write events
   (debounced 120 ms) to deliver the latest user prompt without waiting for
   the next poll interval.

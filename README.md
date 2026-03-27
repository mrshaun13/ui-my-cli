# Devin Dashboard

A browser-based dashboard for managing multiple [Devin CLI](https://windsurf.com) agent sessions. Replaces tab-hunting and keybinding memorization with a click-driven UI: real embedded terminals, live status badges, and one-click agent switching.

```
┌─────────────────────────────────────────────────────┐
│  Browser (localhost:7575)                            │
│  ┌─────────────┐  ┌──────────────────────────────┐  │
│  │ Agent List   │  │  xterm.js Terminal            │  │
│  │              │  │  (real PTY — full CLI feel)   │  │
│  │ ⚡ speakeasy │  │                              │  │
│  │ ⚙ breadcrumb│  │  $ devin --resume abc123     │  │
│  │ · ai-story  │  │  > Working on the fix…       │  │
│  │              │  │  >_                           │  │
│  │ [+ New]      │  │                              │  │
│  └─────────────┘  └──────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────┐ │
│  │ ⚡ needs_you  abc12345  /home/user/speakeasy     │ │
│  │ [✎ Rename]  [⏹ Disconnect PTY]                 │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Features

- **Live status badges** — ⚡ Needs You / ⚙ Running / ◎ Thinking / · Idle, updated every 3 seconds
- **Real terminals** — xterm.js + node-pty: identical to running `devin --resume` in your shell
- **Click to switch** — click any agent in the sidebar to attach its terminal
- **Inline rename** — double-click any agent title to rename it (saved to `~/.config/devin/session-aliases.json`)
- **"Needs You" filter** — one click to show only agents waiting for your input
- **Grouped by project** — sessions bucketed by repo name, collapsible
- **No keybindings** — everything is a button

## Quick Start

### Requirements

- **Node.js 18+** — `node --version`
- **Devin CLI installed and run at least once** — needed to create the sessions database
- **WSL2 / Linux / macOS** — Windows native is not tested

### Install & run

```bash
git clone <repo-url> devin-dashboard
cd devin-dashboard
npm install        # installs server + client deps
npm start          # builds client, starts server
```

Then open **http://localhost:7575** in your browser.

### Development mode (hot reload)

```bash
npm run dev
```

Server runs with `node --watch` (auto-restarts on save).  
Client runs via Vite dev server at **http://localhost:5173** with HMR.

## Configuration

### Port

Default port is `7575`. Override with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

### Database path

The dashboard reads Devin's SQLite session database. Platform defaults:

| Platform       | Default path |
|----------------|-------------|
| Linux / WSL2   | `~/.local/share/devin/cli/sessions.db` |
| macOS          | `~/Library/Application Support/devin/cli/sessions.db` |

Override with the `DEVIN_DB_PATH` environment variable if your setup differs:

```bash
DEVIN_DB_PATH=/custom/path/sessions.db npm start
```

> The database is opened **read-only** — the dashboard never modifies your session data.

## Sharing / Team Setup

This repo is designed to be shareable:

1. Clone it on any machine running the Devin CLI
2. `npm install && npm start`
3. Open the browser

Each person's dashboard reads their own local `sessions.db` — there is no shared database or server required.

### WSL2 + Windows browser

The server binds to `127.0.0.1:7575`. With WSL2, you can access it from Windows at `http://localhost:7575` — WSL2 automatically port-forwards localhost connections from Windows to the Linux environment.

## Architecture

```
server/
  index.js        Express + WebSocket server (port 7575)
  sessions.js     Read-only SQLite queries + status detection
  pty-manager.js  node-pty lifecycle — spawns devin --resume <id>
  db-path.js      Cross-platform database path resolver

client/src/
  App.jsx                   Root layout, session selection state
  components/
    Sidebar.jsx             Agent list, grouping, filter
    AgentCard.jsx           Single session card + inline rename
    Terminal.jsx            xterm.js wrapper + WebSocket PTY bridge
    ControlBar.jsx          Action buttons, session info strip
  hooks/
    useStatusFeed.js        WebSocket /ws/status subscriber (auto-reconnects)
```

### WebSocket protocol

**`/ws/terminal/:sessionId`** — PTY bridge  
Client → Server: `{ type: 'input', data }` | `{ type: 'resize', cols, rows }`  
Server → Client: `{ type: 'output', data }` | `{ type: 'exit', exitCode }`

**`/ws/status`** — status feed  
Server → Client: `{ type: 'sessions', data: Session[] }` every 3 seconds

### Status detection

Derived from the last few `message_nodes` in the Devin SQLite DB:

| Condition | Status |
|-----------|--------|
| Assistant message, no tool calls, idle 30s+ | ⚡ needs_you |
| Assistant message with active tool calls | ⚙ running |
| Tool result or user message, activity < 30s | ◎ thinking |
| No activity for 5+ minutes | · idle |

## License

MIT

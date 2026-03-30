'use strict';
/**
 * doc-prose.js — Editorial prose for the auto-generated docs.
 *
 * This file contains narrative copy that the generator cannot derive from code:
 * taglines, feature descriptions, security policies, architectural summaries, etc.
 *
 * NEVER edit README.md, docs/api.md, docs/architecture.md, or AGENTS.md directly.
 * Edit this file and run `npm run docs` instead.
 */

module.exports = {
  project: {
    title: 'Devin Dashboard',
    tagline:
      'A browser-based dashboard for managing multiple Devin CLI agent sessions. ' +
      'Replaces tab-hunting with a click-driven UI: real embedded terminals, ' +
      'live status badges, analytics, and one-click agent switching.',
  },

  features: [
    '**Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds',
    '**Real terminals** — xterm.js + node-pty: identical to running `devin --resume` in your shell',
    '**Click to switch** — click any agent in the sidebar to attach its live terminal; ' +
      'switching is instant with scrollback preserved',
    '**Session preview** — click the status badge to open a read-only view of any session\'s ' +
      'chat history without spawning a PTY',
    '**Inline rename** — double-click any session title to rename it ' +
      '(writes back to the Devin CLI sessions database)',
    '**Needs-your-input filter** — one click to show only agents waiting for a reply',
    '**Repo filter pills** — filter sessions by project; selection persists across reloads',
    '**Hot/cold grouping** — recent sessions at top, old idle ones behind a configurable day divider',
    '**Archive / restore** — hide sessions from the list without deleting them; ' +
      'restore from the collapsible drawer at the bottom of the sidebar',
    '**Analytics dashboard** — activity heatmap, token usage, tool call breakdown, ' +
      'model distribution, shown when no session is selected',
  ],

  prerequisites: [
    '**Node.js 18+** — `node --version` to check',
    '**Devin CLI installed and run at least once** — creates the sessions database',
    '**Native build tools** for node-pty compilation:',
    '  - **Ubuntu / Debian / WSL2**: `sudo apt install build-essential python3`',
    '  - **macOS**: `xcode-select --install`',
    '  - **Windows**: ' +
      '[Visual Studio Build Tools](https://github.com/nodejs/node-gyp#on-windows) ' +
      '(native Windows untested; WSL2 is the recommended Windows path)',
  ],

  security_model:
    'This dashboard is designed to run **locally on your development machine only**. ' +
    'It binds to `127.0.0.1` (localhost) and has **no authentication**. ' +
    'Anyone who can reach the port can view all sessions, spawn terminals, ' +
    'and modify session titles.\n\n' +
    'If you need remote access, use SSH port-forwarding instead of exposing the port:\n\n' +
    '```bash\nssh -L 7575:localhost:7575 your-remote-host\n```',

  architecture_overview:
    'The server is a single Node.js process (Express + ws) that reads the Devin CLI\'s ' +
    'SQLite database and spawns node-pty processes bridged to browser-based xterm.js terminals. ' +
    'Session data flows one-way from the CLI database to the dashboard — ' +
    'the only writes back to that database are session title renames.',

  data_flow: [
    'Devin CLI  →  sessions.db (SQLite)  →  server polls every 3s  →  WebSocket push  →  React client',
    'Browser  →  xterm.js keystrokes  →  WebSocket  →  node-pty  →  devin --resume <id>',
  ].join('\n'),

  conventions: [
    'Session status values are lowercase strings: `active`, `question`, `finished`, `idle`.' +
      ' The value `archived` is used by the API but not stored in the database.',
    'All server modules use CommonJS (`require` / `module.exports`).',
    'The client uses ES modules with React 19 + Vite.',
    'Archive state is stored in `dashboard.db` (a separate SQLite database in the ' +
      'same directory as sessions.db), not in the Devin CLI\'s SQLite database. ' +
      'If a legacy `hidden-sessions.json` sidecar exists it is migrated automatically on first start.',
    'Production: `npm start` — must run `npm run build` first.',
    'Development: `node --watch server/index.js` + `cd client && npm run dev`.',
  ],

  // Descriptions for REST routes — keyed as "METHOD /path"
  routeDescriptions: {
    'GET /api/status':               'Server health check — returns `ok`, active PTY count, uptime seconds',
    'GET /api/stats':                'Full dashboard analytics — activity, tools, tokens, MCP servers, skills, plugins',
    'GET /api/latest-prompt':        'Most recent user prompt from the `prompt_history` table',
    'GET /api/sessions':             'List all active (non-archived) sessions with derived status',
    'GET /api/sessions/archived':    'List archived (hidden) sessions',
    'GET /api/sessions/:id/preview': 'Rich read-only session detail — chat history, stats, top tools',
    'GET /api/sessions/:id':         'Single session with `ptyActive` flag',
    'POST /api/sessions/:id/rename': 'Update session title (body: `{ title: string }`)',
    'POST /api/sessions/:id/kill-pty': 'Kill the active PTY for a session without archiving it',
    'DELETE /api/sessions/:id':      'Archive a session — kills PTY, hides from active list (reversible)',
    'POST /api/sessions/:id/restore': 'Restore an archived session to the active list',
  },

  // Descriptions for env vars — keyed by variable name
  envVarDescriptions: {
    PORT:                    'HTTP server port',
    NODE_ENV:                'Set to `production` to enable static file serving from `client/dist/`',
    DEVIN_DB_PATH:           'Override the auto-detected Devin CLI SQLite database path',
    DEVIN_DASHBOARD_DB_PATH: 'Override the dashboard.db path (defaults to same dir as sessions.db)',
    SHELL:                   'Shell binary for the node-pty process (falls back to `/bin/bash`)',
    APPDATA:                 'Windows `%APPDATA%` directory — used to find the database path on Windows',
  },
};

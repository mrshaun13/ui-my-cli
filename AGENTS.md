# AGENTS.md — Contributor & AI Agent Guide

## Project Summary

A browser-based dashboard for managing multiple Devin CLI agent sessions. Replaces tab-hunting with a click-driven UI: real embedded terminals, live status badges, analytics, and one-click agent switching.

**Stack:** Node.js >=18.0.0 · Express · WebSocket (`ws`) ·
`better-sqlite3` · `node-pty` · React 19 · Vite · xterm.js

## Build & Run Commands

- `npm run build` — `cd client && npm run build`
- `npm run start` — `NODE_ENV=production node server/index.js`
- `npm run pm2:start` — `npm run build && pm2 start ecosystem.config.cjs`
- `npm run pm2:restart` — `npm run build && pm2 restart devin-dashboard`
- `npm run pm2:stop` — `pm2 stop devin-dashboard`
- `npm run pm2:logs` — `pm2 logs devin-dashboard`
- `npm run postinstall` — `cd client && npm install`
- `npm run docs` — `node scripts/generate-docs.js`
- `npm run docs:check` — `node scripts/generate-docs.js --check`
- `npm run prepare` — `husky`

## Dev Workflow

1. Build the client first: `npm run build` (needed by `npm start`)
2. Start the server: `npm start` → open http://localhost:7575
3. For hot reload: `node --watch server/index.js` + `cd client && npm run dev`
4. After changing source code or `scripts/doc-prose.js`, regenerate docs:
   `npm run docs`

## Important Files to Read First

| File | Why |
|------|-----|
| `server/sessions.js` | Core session data model, status detection, archive logic |
| `server/index.js` | All REST endpoints, WebSocket protocol, broadcast logic |
| `client/src/hooks/useStatusFeed.js` | How the client receives live session updates |
| `client/src/components/Terminal.jsx` | xterm.js + PTY WebSocket bridge |
| `server/pty-manager.js` | node-pty lifecycle, scrollback buffer, WSL env handling |
| `scripts/doc-prose.js` | Editorial prose for auto-generated docs |

## Status Values (Canonical)

These are the only valid status strings in the system, returned by `deriveStatus()`
in `server/sessions.js`. Use them consistently across all client components.

| Value | Meaning |
|-------|---------|
| `active` | Tool calls in flight, or activity within the last 60 seconds |
| `question` | Devin's last message ends with `?` — waiting for your reply |
| `finished` | Devin stopped without a question — task done or paused |
| `idle` | No activity for more than 10 minutes |

The value `archived` is used at the API layer to mean "hidden from the active
list" but is not stored in the database.

## Session Object Shape

```js
// Returned by listSessions() and getSession() in server/sessions.js
{
  id:               string,  // Devin session UUID
  title:            string,  // User-defined or truncated UUID
  workingDir:       string,  // Repo path where devin was run
  project:          string,  // path.basename(workingDir)
  model:            string,  // LLM model name
  status:           string,  // active | question | finished | idle
  snippet:          string,  // Last message text preview (truncated)
  firstUserPrompt:  string,
  lastUserPrompt:   string,
  lastActivityAt:   number,  // Unix epoch (seconds)
  lastActivityAgo:  string,  // Human-readable "2h ago"
  createdAt:        number,  // Unix epoch (seconds)
}
```

## Key Conventions

- Session status values are lowercase strings: `active`, `question`, `finished`, `idle`. The value `archived` is used by the API but not stored in the database.
- All server modules use CommonJS (`require` / `module.exports`).
- The client uses ES modules with React 19 + Vite.
- Archive state is stored in `dashboard.db` (a separate SQLite database in the same directory as sessions.db), not in the Devin CLI's SQLite database. If a legacy `hidden-sessions.json` sidecar exists it is migrated automatically on first start.
- Production: `npm start` — must run `npm run build` first.
- Development: `node --watch server/index.js` + `cd client && npm run dev`.
- **PM2 caveat** — PM2 keeps the old process in memory until explicitly restarted. After any server-side code change, always run `npm run pm2:restart` (which rebuilds the client and restarts the process). A bare `npm run build` is **not enough** — the running Node process still executes the old code.

## Adding a New REST Endpoint

1. Add `app.METHOD('/api/path', handler)` in `server/index.js`
2. If it mutates session data, call `broadcastSessions()` to push an update
3. Add the description to `scripts/doc-prose.js` under `routeDescriptions`
4. Run `npm run docs` — the API reference auto-updates

## Adding a New WebSocket Message Type

1. Emit `JSON.stringify({ type: 'your-type', data: ... })` from the server
2. Handle `msg.type === 'your-type'` in the client hook
   (`useStatusFeed.js` for status-feed messages, `Terminal.jsx` for PTY messages)
3. Document the shape in a JSDoc comment near the send site

## Docs System

All documentation (`README.md`, `docs/api.md`, `docs/architecture.md`,
`AGENTS.md`) is auto-generated. **Never edit those files directly** — your
changes will be overwritten on the next `npm run docs` run.

To update docs:
1. Change source code or edit `scripts/doc-prose.js` (for prose/descriptions)
2. Run `npm run docs`
3. Commit both the code change and the regenerated docs together

The pre-commit hook runs `npm run docs:check` and blocks the commit if any
generated doc is out of sync with the current source.

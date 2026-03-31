#!/usr/bin/env node
'use strict';
/**
 * generate-docs.js — Auto-generates all project documentation from source code.
 *
 * Produces:
 *   README.md            — Project overview, features, quick start, configuration, architecture
 *   docs/api.md          — REST API reference, WebSocket protocol, env vars, localStorage keys
 *   docs/architecture.md — File descriptions, data flow, status state machine, storage model
 *   AGENTS.md            — Build commands, conventions, key patterns for contributors/AI agents
 *
 * Editorial prose lives in scripts/doc-prose.js — edit that file, not the outputs.
 *
 * Usage:
 *   node scripts/generate-docs.js          # regenerate all docs
 *   node scripts/generate-docs.js --check  # exit 1 if any doc is out of sync
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

// ── File helpers ──────────────────────────────────────────────────────────────

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function tryRead(rel, fallback = '') {
  try { return read(rel); } catch { return fallback; }
}

// ── Extractors ────────────────────────────────────────────────────────────────

/** Returns the first /** ... *\/ block in src, stripped of leading " * " prefixes. */
function moduleJsdoc(src) {
  const m = src.match(/^\/\*\*([\s\S]*?)\*\//);
  return m ? m[1].replace(/^\s*\*[ ]?/gm, '').trim() : '';
}

/** Returns the first line of the module JSDoc block (the one-liner summary). */
function moduleOneliner(src) {
  const doc = moduleJsdoc(src);
  if (!doc) return '';
  return doc.split('\n')[0].trim();
}

/** Extracts all app.METHOD('/path', ...) route definitions from Express server source. */
function extractRoutes(src) {
  const result = [];
  const re = /app\.(get|post|delete|put|patch)\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[2] === '*') continue; // skip catch-all
    result.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return result;
}

/**
 * Extracts all process.env.VAR_NAME references from a set of source files.
 * For each variable, records its name, the default value (if a string literal
 * follows `||`), and the file where it first appears.
 */
function extractEnvVars(sources) {
  const seen = new Map();
  const re = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  for (const { name, src } of sources) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const key = m[1];
      if (seen.has(key)) continue;
      const snip = src.slice(m.index, m.index + 100);
      const defM = snip.match(/process\.env\.[A-Z_]+\s*\|\|\s*['"]([^'"]+)['"]/);
      seen.set(key, {
        key,
        default: defM ? defM[1] : '—',
        file: path.basename(name),
      });
    }
  }
  return [...seen.values()];
}

/**
 * Extracts the JSDoc comment immediately before `function deriveStatus(` from src.
 * Returns the stripped text (leading " * " removed).
 */
function extractStatusJsdoc(src) {
  const fnIdx = src.indexOf('function deriveStatus(');
  if (fnIdx === -1) return '';
  const before = src.slice(0, fnIdx);
  const m = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  return m ? m[1].replace(/^\s*\*[ ]?/gm, '').trim() : '';
}

/**
 * Parses the deriveStatus JSDoc into a list of { status, description } objects.
 * Handles the multi-line continuation style used in sessions.js.
 */
function parseStatusTable(jsdoc) {
  const lines  = jsdoc.split('\n');
  const rows   = [];
  let current  = null;
  for (const line of lines) {
    // A line starting a new status: "  active    — ..."
    const m = line.match(/^\s*(active|question|finished|idle)\s+[\u2014\u2013-]+\s*(.+)/);
    if (m) {
      if (current) rows.push(current);
      current = { status: m[1], description: m[2].trim() };
    } else if (current && /^\s{8,}/.test(line) && line.trim()) {
      // Continuation line (indented to align with description column)
      current.description += ' ' + line.trim();
    }
  }
  if (current) rows.push(current);
  return rows;
}

/**
 * Extracts all 'devin-dash:key-name' localStorage key strings from a set of sources.
 * For each, also captures the const variable name if the string is assigned to one.
 */
function extractLocalStorageKeys(sources) {
  const keys = [];
  const seen = new Set();
  const re   = /'(devin-dash:[\w-]+)'/g;
  for (const { name, src } of sources) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const key = m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const before = src.slice(Math.max(0, m.index - 120), m.index);
      const varM   = before.match(/const\s+(\w+)\s*=\s*$/);
      keys.push({ key, varName: varM ? varM[1] : null, file: path.basename(name) });
    }
  }
  return keys;
}

// ── Data collection ───────────────────────────────────────────────────────────

function collect() {
  const prose = require('./doc-prose.js');

  const indexSrc    = read('server/index.js');
  const sessionsSrc = read('server/sessions.js');
  const statsSrc    = read('server/stats.js');
  const ptyMgrSrc   = read('server/pty-manager.js');
  const dbPathSrc   = read('server/db-path.js');

  const pkg       = JSON.parse(read('package.json'));
  const clientPkg = JSON.parse(read('client/package.json'));

  const serverSources = [
    { name: 'server/index.js',      src: indexSrc    },
    { name: 'server/sessions.js',   src: sessionsSrc },
    { name: 'server/stats.js',      src: statsSrc    },
    { name: 'server/pty-manager.js',src: ptyMgrSrc   },
    { name: 'server/db-path.js',    src: dbPathSrc   },
  ];

  const clientKeyFiles = [
    'client/src/components/Sidebar.jsx',
    'client/src/hooks/useStatusFeed.js',
  ];

  // File one-liner descriptions extracted from module JSDoc
  const fileDescs = {};
  for (const { name, src } of serverSources) {
    fileDescs[name] = moduleOneliner(src);
  }
  for (const rel of [
    'client/src/App.jsx',
    'client/src/components/Sidebar.jsx',
    'client/src/components/AgentCard.jsx',
    'client/src/components/Terminal.jsx',
    'client/src/components/ControlBar.jsx',
    'client/src/components/DashboardSplash.jsx',
    'client/src/components/SessionPreview.jsx',
    'client/src/hooks/useStatusFeed.js',
  ]) {
    fileDescs[rel] = moduleOneliner(tryRead(rel));
  }

  const statusJsdoc  = extractStatusJsdoc(sessionsSrc);
  const statusRows   = parseStatusTable(statusJsdoc);
  const lsKeys       = extractLocalStorageKeys(
    clientKeyFiles.map(rel => ({ name: rel, src: tryRead(rel) }))
  );

  return {
    prose,
    routes:    extractRoutes(indexSrc),
    envVars:   extractEnvVars(serverSources),
    statusRows,
    lsKeys,
    pkg,
    clientPkg,
    fileDescs,
  };
}

// ── Markdown table helpers ────────────────────────────────────────────────────

function mdTable(headers, rows) {
  const divider = headers.map(() => '---');
  return [headers, divider, ...rows]
    .map(cols => '| ' + cols.join(' | ') + ' |')
    .join('\n');
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildReadme(d) {
  const { prose, routes, envVars, statusRows, pkg } = d;

  const featureList = prose.features.map(f => `- ${f}`).join('\n');
  // Items that already start with spaces are sub-items; don't add another "- " prefix
  const prereqList  = prose.prerequisites.map(p => p.startsWith('  ') ? p : `- ${p}`).join('\n');

  const dbPathTable = mdTable(
    ['Platform', 'Default path'],
    [
      ['Linux / WSL2', '`~/.local/share/devin/cli/sessions.db`'],
      ['macOS',        '`~/.local/share/devin/cli/sessions.db`'],
      ['Windows',      '`%APPDATA%\\devin\\cli\\sessions.db`'],
    ]
  );

  const envTable = mdTable(
    ['Variable', 'Default', 'Description'],
    envVars.map(v => [
      `\`${v.key}\``,
      `\`${v.default}\``,
      prose.envVarDescriptions[v.key] || '',
    ])
  );

  const serverSection = Object.entries(d.fileDescs)
    .filter(([k]) => k.startsWith('server/'))
    .map(([k, v]) => `  ${k.padEnd(28)} ${v}`)
    .join('\n');

  const clientSection = Object.entries(d.fileDescs)
    .filter(([k]) => k.startsWith('client/'))
    .map(([k, v]) => `  ${k.padEnd(48)} ${v}`)
    .join('\n');

  const statusTable = statusRows.length
    ? mdTable(
        ['Status', 'Meaning'],
        statusRows.map(r => [`\`${r.status}\``, r.description])
      )
    : '';

  return `\
# ${prose.project.title}

${prose.project.tagline}

## Features

${featureList}

## Quick Start

### Prerequisites

${prereqList}

### Install & Run

\`\`\`bash
git clone <repo-url> devin-dashboard
cd devin-dashboard
npm install        # installs server + client deps; node-pty compiles native bindings
npm run build      # compile the Vite client bundle
npm start          # start the dashboard server
\`\`\`

Open **http://localhost:7575** in your browser.

### Development Mode (hot reload)

\`\`\`bash
# Terminal 1 — server with auto-restart
node --watch server/index.js

# Terminal 2 — Vite client with HMR
cd client && npm run dev
\`\`\`

The Vite dev server runs at **http://localhost:5173** and proxies all
\`/api\` and \`/ws\` calls to the server.

### PM2 (persistent background process)

\`\`\`bash
npm run pm2:start    # build + start under PM2
npm run pm2:restart  # rebuild + restart
npm run pm2:stop     # stop
npm run pm2:logs     # tail logs
\`\`\`

## Configuration

### Port

Default is \`7575\`. Override with the \`PORT\` environment variable:

\`\`\`bash
PORT=8080 npm start
\`\`\`

### Database Path

The dashboard reads the Devin CLI SQLite database. Platform defaults:

${dbPathTable}

Override with \`DEVIN_DB_PATH\`:

\`\`\`bash
DEVIN_DB_PATH=/custom/path/sessions.db npm start
\`\`\`

Session title renames are written back to the database, so they appear
in \`devin list\` and inside active sessions.

### All Environment Variables

${envTable}

## Architecture

\`\`\`
server/
${serverSection}

client/src/
${clientSection}
\`\`\`

### WebSocket Protocol

**\`/ws/terminal/:sessionId\`** — PTY bridge

- Client → Server: \`{ type: "input", data }\` | \`{ type: "resize", cols, rows }\`
- Server → Client: \`{ type: "output", data }\` | \`{ type: "exit", exitCode }\`

**\`/ws/status\`** — live session status feed (server-push only)

- Server → Client: \`{ type: "sessions", data: Session[] }\` every 3 seconds
- Server → Client: \`{ type: "latest-prompt", data }\` on DB write events

### Status Detection

Derived from the last few \`message_nodes\` rows in the SQLite database:

${statusTable}

## Security Model

${prose.security_model}

## License

MIT
`;
}

function buildApiDoc(d) {
  const { prose, routes, envVars, lsKeys } = d;

  const routeTable = mdTable(
    ['Method', 'Path', 'Description'],
    routes.map(r => {
      const key  = `${r.method} ${r.path}`;
      const desc = prose.routeDescriptions[key] || '';
      return [`\`${r.method}\``, `\`${r.path}\``, desc];
    })
  );

  const envTable = mdTable(
    ['Variable', 'Default', 'Description'],
    envVars.map(v => [
      `\`${v.key}\``,
      `\`${v.default}\``,
      prose.envVarDescriptions[v.key] || '',
    ])
  );

  const lsTable = lsKeys.length
    ? mdTable(
        ['Key', 'File'],
        lsKeys.map(k => [`\`${k.key}\``, `\`${k.file}\``])
      )
    : '_No keys extracted._';

  return `\
# API Reference

All REST endpoints return JSON. Error responses use \`{ "error": "..." }\`
with an appropriate HTTP status code.

## REST Endpoints

${routeTable}

## WebSocket Endpoints

### \`/ws/terminal/:sessionId\`

PTY bridge — bidirectional terminal I/O. Connect with a session ID to attach
to (or spawn) that session's terminal process.

**Optional query parameters:** \`?cols=220&rows=50\`

**Client → Server:**

${mdTable(
  ['Message type', 'Fields'],
  [
    ['`input`',  '`{ type: "input", data: string }` — keystrokes to send to PTY'],
    ['`resize`', '`{ type: "resize", cols: number, rows: number }` — terminal resize event'],
  ]
)}

**Server → Client:**

${mdTable(
  ['Message type', 'Fields'],
  [
    ['`output`', '`{ type: "output", data: string }` — raw PTY output chunk'],
    ['`exit`',   '`{ type: "exit", exitCode: number }` — PTY process exited'],
  ]
)}

New connections receive a replay of the last 256 KB of PTY output immediately
on connect, so switching back to a session shows its terminal history.

### \`/ws/status\`

Live session status feed. The server pushes updates automatically — no client
requests needed after the initial connection.

**Server → Client:**

${mdTable(
  ['Message type', 'Fields', 'Trigger'],
  [
    ['`sessions`',      '`{ type: "sessions", data: Session[] }`',                              'Every 3 seconds + immediately on connect + after mutations'],
    ['`latest-prompt`', '`{ type: "latest-prompt", data: { content, timestamp, isShell } }`',   'DB write events + immediately on connect'],
  ]
)}

## Environment Variables

${envTable}

## Client localStorage Keys

These keys are written by the client to persist user preferences across
browser reloads. They are never sent to the server.

${lsTable}
`;
}

function buildArchitectureDoc(d) {
  const { prose, fileDescs, statusRows, pkg, clientPkg } = d;

  const serverFileTable = mdTable(
    ['File', 'Description'],
    Object.entries(fileDescs)
      .filter(([k]) => k.startsWith('server/'))
      .map(([k, v]) => [`\`${k}\``, v])
  );

  const clientFileTable = mdTable(
    ['File', 'Description'],
    Object.entries(fileDescs)
      .filter(([k]) => k.startsWith('client/'))
      .map(([k, v]) => [`\`${k}\``, v])
  );

  const serverDepTable = mdTable(
    ['Package', 'Version'],
    Object.entries(pkg.dependencies || {}).map(([k, v]) => [`\`${k}\``, `\`${v}\``])
  );

  const clientDepTable = mdTable(
    ['Package', 'Version'],
    Object.entries(clientPkg.dependencies || {}).map(([k, v]) => [`\`${k}\``, `\`${v}\``])
  );

  const statusTable = statusRows.length
    ? mdTable(
        ['Status', 'Condition'],
        statusRows.map(r => [`\`${r.status}\``, r.description])
      )
    : '';

  return `\
# Architecture

## Overview

${prose.architecture_overview}

## Data Flow

\`\`\`
${prose.data_flow.trim()}
\`\`\`

## Server Files

${serverFileTable}

## Client Files

${clientFileTable}

## Server Dependencies

${serverDepTable}

## Client Dependencies

${clientDepTable}

## Status State Machine

The \`deriveStatus()\` function in \`server/sessions.js\` reads the last 5
\`message_nodes\` rows for a session and returns one of four status values:

${statusTable}

The full logic (edge cases, timing thresholds) lives in \`server/sessions.js\`.
This table is extracted verbatim from the function's JSDoc block.

## Storage Model

| Data | Location | Access |
|------|----------|--------|
| Session records, titles, message history | Devin CLI \`sessions.db\` (SQLite) | Read-only; title renames write to \`sessions.title\` |
| Archived session IDs | \`dashboard.db\` (SQLite, same directory as sessions.db) | Read-write (dashboard only) |
| User preferences (repo filters, cold-days threshold) | Browser \`localStorage\` | Client-side only; never sent to server |

## WebSocket Architecture

The server maintains two WebSocket namespaces:

1. **PTY bridge** (\`/ws/terminal/:id\`) — One \`node-pty\` process per session ID.
   Multiple browser tabs can attach to the same PTY simultaneously and share
   the same terminal stream. A rolling 256 KB scrollback buffer replays
   terminal history to new connections.

2. **Status feed** (\`/ws/status\`) — Server-push only. Sends the full session
   list every 3 seconds. Also watches the SQLite WAL file for write events
   (debounced 120 ms) to deliver the latest user prompt without waiting for
   the next poll interval.
`;
}

function buildAgentsMd(d) {
  const { prose, pkg } = d;

  const scriptList = Object.entries(pkg.scripts || {})
    .map(([k, v]) => `- \`npm run ${k}\` — \`${v}\``)
    .join('\n');

  const conventionList = prose.conventions.map(c => `- ${c}`).join('\n');

  // ── Testing section ────────────────────────────────────────────────────────
  const t = prose.testing || {};
  const testPrereqs = (t.prerequisites || []).map(p => `- ${p}`).join('\n');
  const testCommands = Object.entries(t.commands || {})
    .map(([cmd, desc]) => `| \`${cmd}\` | ${desc} |`)
    .join('\n');
  const testGotchas = (t.gotchas || []).map(g => `- ${g}`).join('\n');
  const testWriting = (t.writing_tests || []).map(w => `- ${w}`).join('\n');
  const testFiles = Object.entries(t.file_inventory || {})
    .map(([f, desc]) => `| \`${f}\` | ${desc} |`)
    .join('\n');

  return `\
# AGENTS.md — Contributor & AI Agent Guide

## Project Summary

${prose.project.tagline}

**Stack:** Node.js ${pkg.engines?.node || '>=18'} · Express · WebSocket (\`ws\`) ·
\`better-sqlite3\` · \`node-pty\` · React 19 · Vite · xterm.js

## Build & Run Commands

${scriptList}

## Dev Workflow

1. Build the client first: \`npm run build\` (needed by \`npm start\`)
2. Start the server: \`npm start\` → open http://localhost:7575
3. For hot reload: \`node --watch server/index.js\` + \`cd client && npm run dev\`
4. After changing source code or \`scripts/doc-prose.js\`, regenerate docs:
   \`npm run docs\`

## Important Files to Read First

| File | Why |
|------|-----|
| \`server/sessions.js\` | Core session data model, status detection, archive logic |
| \`server/index.js\` | All REST endpoints, WebSocket protocol, broadcast logic |
| \`client/src/hooks/useStatusFeed.js\` | How the client receives live session updates |
| \`client/src/components/Terminal.jsx\` | xterm.js + PTY WebSocket bridge |
| \`server/pty-manager.js\` | node-pty lifecycle, scrollback buffer, WSL env handling |
| \`scripts/doc-prose.js\` | Editorial prose for auto-generated docs |

## Status Values (Canonical)

These are the only valid status strings in the system, returned by \`deriveStatus()\`
in \`server/sessions.js\`. Use them consistently across all client components.

| Value | Meaning |
|-------|---------|
| \`active\` | Tool calls in flight, or activity within the last 60 seconds |
| \`question\` | Devin's last message ends with \`?\` — waiting for your reply |
| \`finished\` | Devin stopped without a question — task done or paused |
| \`idle\` | No activity for more than 10 minutes |

The value \`archived\` is used at the API layer to mean "hidden from the active
list" but is not stored in the database.

## Session Object Shape

\`\`\`js
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
\`\`\`

## Key Conventions

${conventionList}

## Adding a New REST Endpoint

1. Add \`app.METHOD('/api/path', handler)\` in \`server/index.js\`
2. If it mutates session data, call \`broadcastSessions()\` to push an update
3. Add the description to \`scripts/doc-prose.js\` under \`routeDescriptions\`
4. Run \`npm run docs\` — the API reference auto-updates

## Adding a New WebSocket Message Type

1. Emit \`JSON.stringify({ type: 'your-type', data: ... })\` from the server
2. Handle \`msg.type === 'your-type'\` in the client hook
   (\`useStatusFeed.js\` for status-feed messages, \`Terminal.jsx\` for PTY messages)
3. Document the shape in a JSDoc comment near the send site

## Docs System

All documentation (\`README.md\`, \`docs/api.md\`, \`docs/architecture.md\`,
\`AGENTS.md\`) is auto-generated. **Never edit those files directly** — your
changes will be overwritten on the next \`npm run docs\` run.

To update docs:
1. Change source code or edit \`scripts/doc-prose.js\` (for prose/descriptions)
2. Run \`npm run docs\`
3. Commit both the code change and the regenerated docs together

The pre-commit hook runs \`npm run docs:check\` and blocks the commit if any
generated doc is out of sync with the current source.

## Testing (Playwright E2E)

${t.overview || ''}

### Prerequisites

${testPrereqs}

### Commands

| Command | Description |
|---------|-------------|
${testCommands}

### Gotchas & Pitfalls

${testGotchas}

### Writing New Tests

${testWriting}

### Test File Inventory

| File | Description |
|------|-------------|
${testFiles}

### Ad-Hoc Visual Testing

${t.ad_hoc_testing || ''}
`;
}

// ── Outputs ───────────────────────────────────────────────────────────────────

const OUTPUTS = [
  { rel: 'README.md',              build: buildReadme       },
  { rel: 'docs/api.md',            build: buildApiDoc       },
  { rel: 'docs/architecture.md',   build: buildArchitectureDoc },
  { rel: 'AGENTS.md',              build: buildAgentsMd     },
];

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  let data;
  try {
    data = collect();
  } catch (err) {
    console.error('[docs] Data collection failed:', err.message);
    process.exit(1);
  }

  let stale = false;

  for (const { rel, build } of OUTPUTS) {
    let content;
    try {
      content = build(data);
    } catch (err) {
      console.error(`[docs] Failed to build ${rel}:`, err.message);
      process.exit(1);
    }

    const outputPath = path.join(ROOT, rel);

    if (CHECK) {
      const existing = tryRead(rel);
      if (existing !== content) {
        console.error(`[docs] Stale: ${rel}`);
        stale = true;
      }
    } else {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, content, 'utf8');
      console.log(`[docs] Generated ${rel}`);
    }
  }

  if (CHECK) {
    if (stale) {
      console.error('[docs] Run `npm run docs` to regenerate.');
      process.exit(1);
    } else {
      console.log('[docs] All docs are up to date.');
    }
  } else {
    console.log('[docs] Done.');
  }
}

main();

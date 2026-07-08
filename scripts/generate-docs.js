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

/** Extracts app.METHOD('/path', ...) and app.METHOD(['/path', ...], ...) route definitions. */
function extractRoutes(src) {
  const result = [];
  const seen = new Set();
  const add = (method, routePath) => {
    if (routePath === '*') return;
    const key = `${method.toUpperCase()} ${routePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ method: method.toUpperCase(), path: routePath });
  };
  const re = /app\.(get|post|delete|put|patch)\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    add(m[1], m[2]);
  }
  const arrayRe = /app\.(get|post|delete|put|patch)\(\s*\[([^\]]+)\]/g;
  while ((m = arrayRe.exec(src)) !== null) {
    const method = m[1];
    const paths = m[2].match(/['"]([^'"]+)['"]/g) || [];
    for (const raw of paths) add(method, raw.slice(1, -1));
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
 * Extracts static dashboard localStorage key strings from a set of sources.
 * For each, also captures the const variable name if the string is assigned to one.
 */
function extractLocalStorageKeys(sources) {
  const keys = [];
  const seen = new Set();
  const re   = /'((?:codex|agent)-dash:[\w-]+)'/g;
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
  const codexPathSrc = read('server/codex-paths.js');
  const codexStoreSrc = read('server/codex-store.js');
  const codexTokenActivitySrc = read('server/codex-token-activity.js');
  const dashboardStoreSrc = read('server/dashboard-store.js');
  const transcriptHeadlessStoreSrc = read('server/transcript-headless-store.js');
  const providerIndexSrc = read('server/providers/index.js');
  const providerCodexSrc = read('server/providers/codex/index.js');
  const providerCodexExecutableSrc = read('server/providers/codex/executable.js');
  const providerDevinSrc = read('server/providers/devin/index.js');
  const providerDevinPathsSrc = read('server/providers/devin/paths.js');

  const pkg       = JSON.parse(read('package.json'));
  const clientPkg = JSON.parse(read('client/package.json'));

  const serverSources = [
    { name: 'server/index.js',      src: indexSrc    },
    { name: 'server/sessions.js',   src: sessionsSrc },
    { name: 'server/stats.js',      src: statsSrc    },
    { name: 'server/pty-manager.js',src: ptyMgrSrc   },
    { name: 'server/db-path.js',    src: dbPathSrc   },
    { name: 'server/codex-paths.js', src: codexPathSrc },
    { name: 'server/codex-store.js', src: codexStoreSrc },
    { name: 'server/codex-token-activity.js', src: codexTokenActivitySrc },
    { name: 'server/dashboard-store.js', src: dashboardStoreSrc },
    { name: 'server/transcript-headless-store.js', src: transcriptHeadlessStoreSrc },
    { name: 'server/providers/index.js', src: providerIndexSrc },
    { name: 'server/providers/codex/index.js', src: providerCodexSrc },
    { name: 'server/providers/codex/executable.js', src: providerCodexExecutableSrc },
    { name: 'server/providers/devin/index.js', src: providerDevinSrc },
    { name: 'server/providers/devin/paths.js', src: providerDevinPathsSrc },
  ];

  const clientKeyFiles = [
    'client/src/App.jsx',
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
  fileDescs['native/CodexNative/MainWindow.axaml.cs'] =
    'Cross-platform native dashboard shell, persistent Codex tabs, direct local shell tabs, push telemetry, cohort analytics, latest-prompt navigation, search, and preferences.';
  fileDescs['native/CodexNative/MainWindow.axaml'] =
    'Native dashboard layout with theme-aware control chrome and the in-app pixel C identity.';
  fileDescs['native/CodexNative/Assets/codex-native-icon.png'] =
    'Transparent generated pixel-art C used by the native dashboard header.';
  fileDescs['native/CodexNative/Assets/codex-native-icon.ico'] =
    'Multi-resolution Windows executable and title-bar icon bundle.';
  fileDescs['native/CodexNative/DashboardApiClient.cs'] =
    'Typed localhost client for sessions, repos, stats, context, configuration, rename, and archive metadata.';
  fileDescs['native/CodexNative/DashboardTheme.cs'] =
    'Native equivalents of the browser dashboard themes and text-size choices.';
  fileDescs['native/CodexNative/DashboardServiceManager.cs'] =
    'Starts the local ui-my-cli service in WSL2 or macOS when port 7575 is unavailable.';
  fileDescs['native/CodexNative.Core/NativeLaunchBuilder.cs'] =
    'Validated launch specifications for the loopback terminal bridge, local shells, and private Windows/macOS service.';
  fileDescs['native/CodexNative.TerminalHost/Program.cs'] =
    'Cross-platform console companion for persistent server-terminal bridging and Windows WSL startup.';
  fileDescs['native/CodexNative.TerminalHost/TerminalBridge.cs'] =
    'Bidirectional console/WebSocket bridge that lets native terminal views reattach to persistent server PTYs.';
  fileDescs['native/CodexNative.Core/NativePlatform.cs'] =
    'Explicit Windows, macOS, and Linux native runtime profile and artifact naming.';
  fileDescs['native/CodexNative.Core/ExecutableResolver.cs'] =
    'Validated Node.js and login-shell discovery without user-controlled shell interpolation.';
  fileDescs['native/CodexNative.Core/DashboardRepositoryLocator.cs'] =
    'Finds a valid ui-my-cli checkout from explicit configuration, app location, or conventional home paths.';
  fileDescs['native/CodexNative.Core/DashboardApiCompatibility.cs'] =
    'Exact native-client/server API compatibility policy that rejects stale services with incomplete analytics contracts.';
  fileDescs['native/CodexNative.Core/DashboardServicePorts.cs'] =
    'Bounded private-service port policy used to bypass incompatible or orphaned loopback services safely.';
  fileDescs['native/CodexNative.Core/TokenChartMath.cs'] =
    'Shared-scale chart math that keeps native input/output token comparisons proportional.';
  fileDescs['native/CodexNative.Core/GitHubReleaseClient.cs'] =
    'Selects a newer stable GitHub Release and its exact platform archive/checksum through trusted HTTPS URLs.';
  fileDescs['native/CodexNative.Core/NativeUpdatePackage.cs'] =
    'Downloads bounded release assets, verifies SHA-256, and rejects traversal, links, or incomplete native payloads.';
  fileDescs['native/CodexNative.Core/NativeInstallRequest.cs'] =
    'Validated structured update handoff arguments and installed-app layout resolution.';
  fileDescs['native/CodexNative/NativeUpdateService.cs'] =
    'Native release check, verified staging, and external updater launch orchestration.';
  fileDescs['native/CodexNative.Updater/Program.cs'] =
    'Out-of-process atomic installation, rollback, and native-app restart helper.';
  fileDescs['native/CodexNative/DashboardStatusFeed.cs'] =
    'Reconnecting Codex status-feed client for push-driven native session updates and rekey events.';
  fileDescs['native/CodexNative/AnalyticsControls.cs'] =
    'Animated, hoverable native charts for token activity, heatmaps, project trends, segmented token bars, and context composition.';
  fileDescs['native/CodexNative/SessionPreviewControl.cs'] =
    'Rich native session summary with conversation history, context composition, model changes, and Codex subagent timelines.';
  fileDescs['native/CodexNative/DashboardModels.cs'] =
    'Typed Codex dashboard, context, analytics, conversation, rate-limit, and subagent payload models.';

  const statusJsdoc  = extractStatusJsdoc(sessionsSrc);
  const statusRows   = parseStatusTable(statusJsdoc);
  if (statusRows.length === 0) {
    statusRows.push(
      { status: 'active', description: 'Codex activity within the last 60 seconds.' },
      { status: 'question', description: 'Latest assistant text ends with `?`, indicating a likely prompt for your input.' },
      { status: 'finished', description: 'Recent non-idle session with no detected question.' },
      { status: 'idle', description: 'No activity for more than 10 minutes.' },
    );
  }
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
    ['Provider', 'Default local state'],
    [
      ['Codex', '`~/.codex/state_*.sqlite` + `~/.codex/sessions/**/*.jsonl`'],
      ['Devin', '`$XDG_DATA_HOME/devin/cli/sessions.db` or `~/.local/share/devin/cli/sessions.db`'],
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

  const nativeSection = Object.entries(d.fileDescs)
    .filter(([k]) => k.startsWith('native/'))
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
git clone <repo-url> codex-dashboard
cd codex-dashboard
npm install        # installs server + client deps; node-pty compiles native bindings
npm run build      # compile the Vite client bundle
npm start          # start the dashboard server
\`\`\`

Open **http://localhost:7575** in your browser.

### Native Windows and macOS frontend

The native frontend uses a real operating-system PTY terminal view attached
through a small console bridge to persistent PTYs owned by the dashboard service.
Windows runs the service and Codex in WSL2; macOS runs both locally.
Its Avalonia shell adds push-driven sessions, multi-project and archived search,
rich previews, interactive cohort analytics, latest-prompt navigation, context
composition, Codex subagent timelines, desktop shortcuts, provider/quota health,
styles, and text resizing.
Closing the native UI leaves Codex running; reopening it reattaches with recent
scrollback. A private loopback service is started automatically when needed.

\`\`\`bash
npm run native:test
npm run native:build
npm run native:publish
\`\`\`

Self-contained artifacts are published under \`native/artifacts/win-x64/\`,
\`native/artifacts/osx-x64/\`, and \`native/artifacts/osx-arm64/\`. See
\`native/README.md\` for platform prerequisites and packaging details.

Versioned release downloads are published in
[GitHub Releases](https://github.com/mrshaun13/ui-my-cli/releases) as
\`CodexNative-v<version>-win-x64.zip\`,
\`CodexNative-v<version>-osx-x64.zip\`, and
\`CodexNative-v<version>-osx-arm64.zip\`, each with a SHA-256 manifest. Pull
request workflow artifacts use the same unambiguous names but are temporary
validation outputs rather than stable releases.

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

### Provider State Paths

The dashboard reads local provider state. Defaults:

${dbPathTable}

Override Codex with \`CODEX_HOME\` or \`CODEX_STATE_DB_PATH\`:

\`\`\`bash
CODEX_HOME=/custom/codex-home npm start
CODEX_STATE_DB_PATH=/custom/path/state_5.sqlite npm start
\`\`\`

Session title renames are dashboard-local. Codex-owned state is read-only
except archive/restore operations performed through the Codex CLI.
Override Devin with \`DEVIN_DB_PATH\` or \`DEVIN_DASHBOARD_DB_PATH\`.

### All Environment Variables

${envTable}

### Codex Stats Cohorts

The Codex stats endpoint accepts \`statsMode=combined|triage|codex\`.

- \`combined\` blends native Codex sessions with transcript-pipeline Codex headless triage runs.
- \`triage\` shows only transcript-pipeline Codex headless triage runs in the page-level charts.
- \`codex\` shows native Codex CLI / VS Code sessions without transcript-pipeline triage.

Tool Calls intentionally keeps its interactive/headless split stable across modes.

## Architecture

\`\`\`
server/
${serverSection}

client/src/
${clientSection}

native/
${nativeSection}
\`\`\`

### WebSocket Protocol

**\`/ws/:providerId/terminal/:sessionId\`** — PTY bridge

- Client → Server: \`{ type: "input", data }\` | \`{ type: "resize", cols, rows }\`
- Server → Client: \`{ type: "output", data }\` | \`{ type: "exit", exitCode }\`

**\`/ws/:providerId/status\`** — live session status feed (server-push only)

- Server → Client: \`{ type: "sessions", data: Session[] }\` every 3 seconds
- Server → Client: \`{ type: "latest-prompt", data }\` on DB write events

### Status Detection

Derived by the selected provider adapter from local session state:

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

### \`/ws/:providerId/terminal/:sessionId\`

PTY bridge — bidirectional terminal I/O. Connect with a session ID to attach
to (or spawn) that provider session's terminal process.

Compatibility alias: \`/ws/terminal/:sessionId\` uses the default provider.

**Optional query parameters:** \`?cols=80&rows=24\`

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

### \`/ws/:providerId/status\`

Live session status feed. The server pushes updates automatically — no client
requests needed after the initial connection.

Compatibility alias: \`/ws/status\` uses the default provider.

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

  const nativeFileTable = mdTable(
    ['File', 'Description'],
    Object.entries(fileDescs)
      .filter(([k]) => k.startsWith('native/'))
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

## Native Windows and macOS Frontend Files

${nativeFileTable}

## Server Dependencies

${serverDepTable}

## Client Dependencies

${clientDepTable}

## Status State Machine

Each provider adapter returns one of four status values. Codex derives status
from local thread metadata and rollout JSONL; Devin derives status from recent
message_nodes in Devin \`sessions.db\`.

${statusTable}

The Codex logic lives in \`server/codex-store.js\`; the Devin logic lives in
\`server/providers/devin/store.js\`.

## Storage Model

| Data | Location | Access |
|------|----------|--------|
| Session metadata | Codex \`~/.codex/state_*.sqlite\` | Read-only |
| Message history and tool events | Codex rollout JSONL under \`~/.codex/sessions/\` | Read-only |
| Archive state | Codex CLI \`archive\` / \`unarchive\` commands | Codex-owned |
| Transcript-pipeline Codex headless ledgers | \`TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR\` or \`~/git/ai-tell-my-story/transcript-pipeline/data/headless-sessions\` | Read-only |
| Dashboard title overrides and external headless hide state | \`~/.codex/ui-my-cli-dashboard.db\` | Read-write (dashboard only) |
| Devin session metadata/history | Devin \`sessions.db\` | Read-only except title rename |
| Devin archive state | Devin dashboard metadata DB next to \`sessions.db\` | Read-write (dashboard only) |
| User preferences (repo filters, cold-days threshold) | Browser \`localStorage\` | Client-side only; never sent to server |

## WebSocket Architecture

The server maintains two WebSocket namespaces:

1. **PTY bridge** (\`/ws/:providerId/terminal/:id\`) — One \`node-pty\` process per provider/session ID.
   Multiple browser tabs can attach to the same PTY simultaneously and share
   the same terminal stream. A rolling 256 KB scrollback buffer replays
   terminal history to new connections.

2. **Status feed** (\`/ws/:providerId/status\`) — Server-push only. Sends the full session
   list every 3 seconds. Each provider watches its own local state files
   (debounced 120 ms) to deliver updates without waiting for the next poll interval.
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
| \`server/providers/index.js\` | Provider registry, default provider, provider metadata |
| \`server/codex-store.js\` | Core Codex session data model, status detection, archive logic |
| \`server/providers/devin/store.js\` | Legacy Devin session data model, status detection, archive logic |
| \`server/index.js\` | All REST endpoints, WebSocket protocol, broadcast logic |
| \`client/src/hooks/useStatusFeed.js\` | How the client receives live session updates |
| \`client/src/components/Terminal.jsx\` | xterm.js + PTY WebSocket bridge |
| \`server/pty-manager.js\` | node-pty lifecycle, scrollback buffer, WSL env handling |
| \`scripts/doc-prose.js\` | Editorial prose for auto-generated docs |

## Status Values (Canonical)

These are the only valid status strings in the system, returned by provider
status adapters. Use them consistently across all client components.

| Value | Meaning |
|-------|---------|
| \`active\` | Tool calls in flight, or activity within the last 60 seconds |
| \`question\` | Agent's last message ends with \`?\` — waiting for your reply |
| \`finished\` | Agent stopped without a question — task done or paused |
| \`idle\` | No activity for more than 10 minutes |

The value \`archived\` is used at the API layer to mean "hidden from the active
list". Archive behavior is provider-owned: Codex uses \`codex archive\` /
\`codex unarchive\`; Devin uses dashboard-local archive metadata.

## Session Object Shape

\`\`\`js
// Returned by provider listSessions() and getSession()
{
  id:               string,  // Provider session ID
  provider:         string,  // codex | devin
  title:            string,  // User-defined or provider-derived title
  workingDir:       string,  // Repo path where the provider was run
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

${(() => {
  const dp = prose.decision_philosophy;
  if (!dp) return '';
  const principleList = (dp.principles || []).map(p => `- ${p}`).join('\n');
  const checklistItems = (dp.checklist || []).map(c => `- ${c}`).join('\n');
  return `## Decision-Making Philosophy

${dp.preamble}

### Principles

${principleList}

### Pre-Implementation Checklist

Before writing code, run through these questions:

${checklistItems}

`;
})()}## Adding a New REST Endpoint

1. Add \`app.METHOD('/api/:providerId/path', handler)\` in \`server/index.js\`
2. Resolve provider behavior through \`server/providers/index.js\`
3. If it mutates session data, call \`broadcastSessions(provider.id)\` to push an update
4. Add the description to \`scripts/doc-prose.js\` under \`routeDescriptions\`
5. Run \`npm run docs\` — the API reference auto-updates

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

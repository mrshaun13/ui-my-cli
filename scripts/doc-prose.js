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
    title: 'Agent Dashboard',
    tagline:
      'A browser dashboard for managing multiple local headless-agent sessions across Codex and Devin, ' +
      'plus a browser-free Windows frontend for Codex in WSL2. Both surfaces share persistent server PTYs, ' +
      'live status, analytics, search, and session metadata; the native surface renders terminals through ' +
      'Windows ConPTY and can reattach after the UI exits.',
  },

  features: [
    '**Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds',
    '**Provider switch** — top-level Codex / Devin toggle; sessions, repo filters, tabs, stats, archives, and terminals are scoped to the selected provider',
    '**Native Windows frontend** — standalone Avalonia dashboard with push updates, multi-project and archive search, actionable rich previews, responsive layouts, theme-aware control chrome, a custom pixel-art app identity, a rich compact session rail, a searchable Codex-or-Ubuntu WSL project launcher, automatic terminal-bridge reconnect, toggleable keyboard-accessible cohort analytics, latest-prompt navigation, context composition, Codex subagent timelines, keyboard shortcuts, provider/quota health, and persistent Codex terminal reattachment through a Windows ConPTY view',
    '**Real terminals** — xterm.js + node-pty: identical to running the selected provider CLI in your shell (`codex resume <id>` or `devin --resume <id>`)',
    '**Click to switch** — click any agent in the sidebar to attach its live terminal; ' +
      'switching is instant with scrollback preserved',
    '**New session** — floating "+" button in the sidebar lets you start a new Codex or Devin session ' +
      'in any previously-used repo; the terminal opens automatically',
    '**Session preview** — click the status badge to open a read-only view of any session\'s ' +
      'chat history without spawning a PTY',
    '**Inline rename** — double-click any session title to rename it ' +
      '(native Codex titles are written to Codex state so CLI, VS Code, and this dashboard stay aligned; external headless titles use dashboard metadata)',
    '**Needs-your-input filter** — one click to show only agents waiting for a reply',
    '**Repo filter pills** — filter sessions by project; selection persists across reloads',
    '**Persistent native terminals** — Codex PTYs stay in WSL2 when the Windows UI closes; reopening the native app reattaches with buffered scrollback',
    '**Hot/cold grouping** — recent sessions at top, old idle ones behind a configurable day divider',
    '**Archive / restore** — hide sessions from the list without deleting them; ' +
      'restore from the collapsible drawer at the bottom of the sidebar',
    '**Analytics dashboard** — activity heatmap, project combo chart (duration + turns + sessions), ' +
      'token usage, tool call breakdown, model distribution, and Codex stats cohort switching, shown when no session is selected',
    '**Context window pie chart** — per-session donut chart showing context window composition ' +
      '(system prompt, user messages, assistant messages, tool calls, tool results, free capacity)',
    '**Environment banner** — global config overview on the dashboard home page showing active ' +
      'model, MCP servers, skills, and plugins with color-coded chips',
    '**Session config** — per-session provider metadata: source, model, reasoning effort, ' +
      'sandbox policy, approval mode, skills, plugins, and MCP servers where available',
  ],

  prerequisites: [
    '**Node.js 18+** — `node --version` to check',
    '**.NET 10 SDK** — optional; required only to build or publish the native Windows frontend',
    '**Codex CLI installed and run at least once** — creates the Codex state database',
    '**Devin CLI installed and run at least once** — optional, required only for the Devin dashboard/provider',
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
    '```bash\nssh -L 7575:localhost:7575 your-remote-host\n```\n\n' +
    '### Deployment model & dev-server posture\n\n' +
    '- **Production** runs `npm start` → Express (`server/index.js`) serving the ' +
    'pre-built static assets from `client/dist/`. Vite is `devDependencies` only ' +
    'and is **never** running in production.\n' +
    '- **Development** uses `cd client && npm run dev` to run the Vite dev server. ' +
    '`client/vite.config.js` explicitly pins `server.host = "127.0.0.1"` so the ' +
    'dev server is only reachable from the loopback interface. **Do not run ' +
    '`npm run dev -- --host` or remove that pin** — Vite has had multiple ' +
    'CVE-class issues (arbitrary file read via WebSocket `fetchModule`, ' +
    '`.map` path traversal) that are only exploitable when the dev server is ' +
    'reachable over the network.\n\n' +
    '### Dependency pinning policy\n\n' +
    'When a dependency has an active advisory against it, we **exact-pin** ' +
    '(no `^` / `~`) the patched version so a transitive install can\'t silently ' +
    'regress us onto a vulnerable copy. Other deps stay on their floated ' +
    'ranges to keep up with non-security patches automatically. Currently ' +
    'pinned for this reason:\n\n' +
    '- `vite` pinned to `6.4.2` in `client/package.json` (fixes the WebSocket ' +
    '`fetchModule` and `.map` traversal advisories in earlier 6.x).\n' +
    '- `postcss` pinned to `8.5.12` via `client/package.json#overrides` ' +
    '(fixes the `</style>` XSS advisory). The `overrides` block is scoped to ' +
    'the `client/` install root — `client/` runs its own `npm install` (its ' +
    'own lockfile) per the root `postinstall` script, which is what makes the ' +
    'override take effect there.\n\n' +
    'Run `npm audit` from both the repo root and `client/` after any dependency ' +
    'change to confirm zero advisories. When a future advisory clears, you can ' +
    'unpin to rejoin the floated range.',

  architecture_overview:
    'The browser dashboard server is a single Node.js process (Express + ws) with provider adapters for Codex and Devin. ' +
    'Each provider owns its local state reader, archive/restore behavior, stats adapter, and PTY command builder. ' +
    'The React client exposes a hard provider switch so Codex and Devin sessions never mix in one dashboard view. ' +
    'The Codex provider can also read transcript-pipeline headless ledgers that explicitly record `runtime_metadata.agent_id = "codex"`; those external runs stay read-only and are surfaced as transcript-pipeline headless sessions. ' +
    'The Windows native frontend uses Avalonia for the dashboard and Windows ConPTY for terminal rendering. Its console bridge attaches Codex tabs to the same buffered server PTYs as the browser, so Codex and project files remain in WSL2 and sessions can outlive either UI. It can also launch direct Ubuntu login-shell tabs in validated WSL project paths; those shells end when their tab or the application closes.',

  data_flow: [
    'Codex CLI / VS Code  →  ~/.codex state DB + rollout JSONL  →  Codex provider adapter  →  WebSocket push  →  React client',
    'transcript-pipeline Codex headless ledger  →  data/headless-sessions status/events files  →  Codex provider external-read adapter  →  React client',
    'Devin CLI  →  Devin sessions.db + dashboard.db  →  Devin provider adapter  →  WebSocket push  →  React client',
    'Browser  →  xterm.js keystrokes  →  provider-scoped WebSocket  →  node-pty  →  selected provider resume command',
    'Windows native app  →  Avalonia terminal control  →  ConPTY  →  console bridge  →  WebSocket  →  persistent WSL2 PTY  →  Codex CLI',
    'Windows native app  →  Avalonia terminal control  →  ConPTY  →  validated WSL2 launch  →  Ubuntu login shell',
    'Windows native dashboard controls  →  localhost provider API  →  session/context/stats readers  →  Codex state in WSL2',
  ].join('\n'),

  conventions: [
    'Session status values are lowercase strings: `active`, `question`, `finished`, `idle`.' +
      ' The value `archived` is used by the API but not stored in the database.',
    'All server modules use CommonJS (`require` / `module.exports`).',
    'The client uses ES modules with React 19 + Vite.',
    'The native Windows frontend uses .NET 10, Avalonia, an XTerm-compatible terminal control, and ConPTY; it does not embed a browser. Local provider APIs and provider-scoped WebSockets carry metadata and terminal streams only over loopback.',
    'Provider routes are scoped as `/api/:providerId/...` and `/ws/:providerId/...`; legacy `/api/...` and `/ws/...` aliases point to the default provider (`codex`).',
    'Codex archive state is changed through `codex archive` / `codex unarchive` for native Codex sessions. Native Codex titles are stored in Codex `state_*.sqlite`; external transcript-pipeline headless title and hide/restore metadata is stored in `~/.codex/ui-my-cli-dashboard.db`.',
    'Devin archive state remains dashboard-local in the Devin dashboard metadata database next to Devin `sessions.db`.',
    'Production: `npm start` — must run `npm run build` first.',
    'Development: `node --watch server/index.js` + `cd client && npm run dev`.',
    '**PM2 caveat** — PM2 keeps the old process in memory until explicitly restarted.' +
      ' After any server-side code change, always run `npm run pm2:restart`' +
      ' (which rebuilds the client and restarts the process).' +
      ' A bare `npm run build` is **not enough** — the running Node process still executes the old code.',
  ],

  // ── Decision-making philosophy ───────────────────────────────────────────────
  // This section generates the "Decision-Making Philosophy" block in AGENTS.md.
  // It teaches agents to evaluate whether the *best possible* approach is being
  // taken, not just the most expedient one.

  decision_philosophy: {
    preamble:
      'This is a **single-user, single-developer project**. The sole consumer is the person ' +
      'who built it. That changes the calculus on every decision:\n\n' +
      '- There is no legacy team to retrain, no migration guide to write, no deprecation cycle.\n' +
      '- Breaking changes are free — the user will simply rebuild and restart.\n' +
      '- "Correct" means "best long-term outcome for this one person," not "safest for a committee."',

    principles: [
      '**Challenge the premise before implementing.** When asked to add a feature or fix a bug, ' +
        'first ask: is the current architecture the right foundation for this change? ' +
        'If the underlying abstraction is wrong, patching on top just creates well-organized tech debt. ' +
        'Propose the structural fix, explain the trade-off, and let the user decide.',
      '**"Best possible" over "least disruptive."** Do not default to the smallest diff. ' +
        'Evaluate whether a larger refactor would leave the codebase in a fundamentally better state. ' +
        'If so, present that option (with effort estimate) alongside the minimal fix. ' +
        'The user can always choose the quick path, but they should know the better one exists.',
      '**Technology choices are not sacred.** If a library, pattern, or architectural decision ' +
        'is the wrong tool for where the project is heading, say so. ' +
        'Sorted and well-organized "wrong tech" is still wrong tech. ' +
        'Propose the migration path and let the user weigh the cost.',
      '**Think in trajectories, not snapshots.** Each change shapes what future changes are easy ' +
        'or hard. Prefer changes that open up future possibilities over those that close them off, ' +
        'even if the immediate task doesn\'t require it.',
      '**Explain the "why" behind the recommendation.** The user wants to learn and make informed ' +
        'decisions. Don\'t just say "I recommend X" — explain what makes X better than the alternatives ' +
        'and what you\'d lose by choosing them.',
    ],

    checklist: [
      'Is the current abstraction the right one, or am I papering over a design gap?',
      'Would a different data model, component structure, or API shape make this and *future* changes simpler?',
      'Am I reaching for a pattern because it\'s familiar, or because it\'s optimal for this project?',
      'If I were starting this feature from scratch today, would I build it the same way?',
      'What does this change make easier to do next? What does it make harder?',
    ],
  },

  // Descriptions for REST routes — keyed as "METHOD /path"
  routeDescriptions: {
    'GET /api/native/launch/status': 'Capability probe used by the native dashboard to find a browser dashboard that supports reciprocal launching.',
    'POST /api/native/launch':       'Focus the installed Codex Native Windows dashboard, or start it when not already running (Windows/WSL2 only).',
    'GET /api/status':               'Server health check — returns `ok`, default provider, provider availability, active PTY count, uptime seconds',
    'GET /api/providers':            'Provider catalog — returns Codex/Devin labels, commands, availability, version, and UI metadata',
    'GET /api/:providerId/stats':    'Provider-scoped dashboard analytics — activity, tools, tokens, MCP servers, skills, plugins. Codex supports `statsMode=combined|triage|codex` to switch chart cohorts while leaving tool-call columns stable.',
    'GET /api/stats':                'Compatibility alias for `/api/codex/stats` unless `UI_MY_CLI_DEFAULT_PROVIDER` overrides the default; accepts the same stats query params',
    'GET /api/:providerId/latest-prompt': 'Most recent user prompt from the selected provider local state',
    'GET /api/latest-prompt':        'Compatibility alias for the default provider latest prompt',
    'GET /api/:providerId/sessions': 'List all active (non-archived) sessions for one provider with derived status',
    'GET /api/sessions':             'Compatibility alias for the default provider session list',
    'GET /api/:providerId/sessions/archived': 'List archived (hidden) sessions for one provider',
    'GET /api/sessions/archived':    'Compatibility alias for default provider archived sessions',
    'GET /api/:providerId/sessions/search': 'Provider-scoped full-text session search — query param `q` (required), `archived=1` to include archived sessions.',
    'GET /api/sessions/search':      'Compatibility alias for default provider search',
    'GET /api/:providerId/repos':    'List all unique repos (working directories) from one provider\'s past sessions',
    'GET /api/repos':                'Compatibility alias for default provider repos',
    'POST /api/:providerId/sessions/create': 'Start a new session for one provider in the given working directory (body: `{ workingDir: string, adaptive?: boolean }`); returns `{ tempKey }`',
    'POST /api/sessions/create':     'Compatibility alias for default provider session creation',
    'GET /api/codex/adaptive/models': 'Authenticated Codex model catalog used by native Adaptive routing, including each visible model\'s supported reasoning efforts and service tiers.',
    'POST /api/codex/sessions/:id/adaptive/submit': 'Classify and submit one native Adaptive prompt through the shared Codex app-server thread. For a pending session, body `{ text, preference?, workingDir }` starts the first turn before returning its real `sessionId`; later turns use `{ text, preference? }`.',
    'GET /api/:providerId/sessions/:id/preview': 'Provider-scoped rich read-only session detail — chat history, stats, top tools',
    'GET /api/sessions/:id/preview': 'Rich read-only session detail — chat history, stats, top tools',
    'GET /api/:providerId/sessions/:id/conversation': 'Provider-scoped paginated user↔assistant conversation turns for a session.',
    'GET /api/sessions/:id/conversation': 'Paginated user↔assistant conversation turns for a session. Query params: `offset` (number of turns to skip from end, default 0), `limit` (max turns to return, 0 = all, default 50). Returns `{ turns, totalTurns, hasMore }`.',
    'GET /api/:providerId/sessions/:id/subagents': 'Provider-scoped subagent timeline. Codex joins parent `sub_agent_activity` events with child-thread metadata and result previews; Devin reads legacy run_subagent lifecycle data.',
    'GET /api/sessions/:id/subagents': 'Compatibility alias for default provider subagents.',
    'GET /api/:providerId/sessions/:id/context': 'Estimated context breakdown for one provider session. Returns `{ categories, totalUsed, maxContext, freeTokens, compactionCount, model }`.',
    'GET /api/sessions/:id/context': 'Compatibility alias for default provider context.',
    'GET /api/:providerId/sessions/:id/config': 'Per-session provider configuration metadata. Returns `{ rules, activeSkills, permissions, model, permissionMode }` where available.',
    'GET /api/sessions/:id/config': 'Compatibility alias for default provider config.',
    'GET /api/:providerId/sessions/:id': 'Single provider session with `ptyActive` flag',
    'GET /api/sessions/:id':         'Single session with `ptyActive` flag',
    'POST /api/:providerId/sessions/:id/rename': 'Update a provider session title (body: `{ title: string }`)',
    'POST /api/sessions/:id/rename': 'Update session title (body: `{ title: string }`)',
    'POST /api/:providerId/sessions/:id/kill-pty': 'Kill the active provider-scoped PTY for a session without archiving it',
    'POST /api/sessions/:id/kill-pty': 'Kill the active PTY for a session without archiving it',
    'DELETE /api/:providerId/sessions/:id': 'Archive a provider session — kills PTY, hides from active list (reversible)',
    'DELETE /api/sessions/:id':      'Archive a session — kills PTY, hides from active list (reversible)',
    'POST /api/:providerId/sessions/:id/restore': 'Restore an archived provider session to the active list',
    'POST /api/sessions/:id/restore': 'Restore an archived session to the active list',
  },

  // Descriptions for env vars — keyed by variable name
  envVarDescriptions: {
    PORT:                    'HTTP server port',
    NODE_ENV:                'Set to `production` to enable static file serving from `client/dist/`',
    CODEX_HOME:              'Override the Codex home directory (default: `~/.codex`)',
    CODEX_STATE_DB_PATH:     'Override the auto-detected Codex state SQLite database path',
    TRANSCRIPT_PIPELINE_DIR:  'Override the transcript-pipeline checkout used to discover Codex headless run ledgers',
    TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR: 'Override the exact transcript-pipeline `data/headless-sessions` ledger directory',
    UI_MY_CLI_DB_PATH:       'Override the dashboard metadata database path',
    UI_MY_CLI_DEFAULT_PROVIDER: 'Override the compatibility/default provider for legacy `/api/...` and `/ws/...` aliases (default: `codex`)',
    DEVIN_DB_PATH:           'Override the auto-detected Devin `sessions.db` path',
    DEVIN_DASHBOARD_DB_PATH: 'Override the Devin dashboard metadata database path',
    XDG_DATA_HOME:           'Override the XDG data directory (default: `~/.local/share`); affects DB path on all platforms',
    SHELL:                   'Shell binary for the node-pty process (falls back to `/bin/zsh` on macOS, then `/bin/bash`, then `/bin/sh`)',
    APPDATA:                 'Windows `%APPDATA%` directory — used to find the database path on Windows',
  },

  // ── Testing ─────────────────────────────────────────────────────────────────
  // This section generates the Testing block in AGENTS.md.
  // It should contain everything a new developer or AI agent needs to run tests
  // without fumbling through setup.

  testing: {
    overview:
      'E2E tests use **Playwright** (Chromium only) and run against the **live PM2-managed server** on port 7575. ' +
      'There is no `webServer` block in the Playwright config — tests expect the dashboard to already be running. ' +
      'This matches the real production setup and avoids port conflicts with PM2.',

    prerequisites: [
      'Dashboard running via PM2: `npm run pm2:start` (or confirm with `pm2 list`)',
      'At least one Codex CLI session must exist (run `codex` once) — default-provider tests interact with session cards',
      'Playwright browsers installed: `npx playwright install chromium` (one-time setup)',
    ],

    commands: {
      'npm test':                           'Run the full Playwright test suite',
      'npm run test:smoke':                 'Run only the smoke tests (fastest sanity check)',
      'npx playwright test <file>':         'Run a single test file',
      'npx playwright test --ui':           'Open the interactive Playwright UI',
      'npx playwright show-report':         'Open the last HTML test report',
    },

    gotchas: [
      '**Server must be running first.** Tests do NOT start the server — they hit `localhost:7575` ' +
        'served by PM2. If the server is down, tests fail with a clear message: ' +
        '"Dashboard not reachable... Start it first: npm run pm2:start".',
      '**Session cards arrive via WebSocket**, not in the initial HTML. The sidebar renders ' +
        '"No sessions found" until the provider-scoped `/ws/:providerId/status` WebSocket delivers the first `sessions` message ' +
        '(up to 3 seconds). Use `waitForSessions(page)` from `tests/helpers.js` instead of ' +
        'a bare `page.goto("/")` when you need session cards.',
      '**After server code changes**, run `npm run pm2:restart` (not just `npm run build`). ' +
        'PM2 keeps the old process in memory.',
      '**Port override:** Set `PORT=XXXX` before running tests if the server is on a non-default port. ' +
        'The Playwright config and helpers both read `process.env.PORT`.',
      '**Chromium only.** Firefox and WebKit are not installed. The Playwright config has a ' +
        'single `chromium` project. Run `npx playwright install` to add other browsers.',
    ],

    writing_tests: [
      'Put test files in `tests/` with the `.spec.js` extension.',
      'Import helpers: `import { ensureServerRunning, waitForSessions, SELECTORS } from \'./helpers.js\'`',
      'Always call `test.beforeAll(ensureServerRunning)` — it validates the server is reachable ' +
        'and fails fast with a helpful message instead of cryptic connection timeouts.',
      'Use `waitForSessions(page)` to navigate and wait for session cards to appear ' +
        '(handles the WebSocket timing automatically).',
      'Use `SELECTORS` from helpers for consistent CSS selectors across all tests. ' +
        'If you add a new UI element, add its selector to `SELECTORS` so other tests can use it.',
      'Failure screenshots are saved automatically to `test-results/` (gitignored).',
    ],

    file_inventory: {
      'playwright.config.js':    'Playwright config — baseURL, reporter, project (Chromium)',
      'tests/helpers.js':        'Shared test utilities — `ensureServerRunning`, `waitForSessions`, `SELECTORS`',
      'tests/smoke.spec.js':     'Smoke tests — server health, sidebar rendering, terminal open, search',
    },

    ad_hoc_testing:
      'For quick visual checks without writing a spec file, you can use Playwright\'s ' +
      'API directly via a one-off Node.js script. This is useful for debugging UI issues:\n\n' +
      '```js\n' +
      'import { chromium } from \'playwright\';\n' +
      'const browser = await chromium.launch({ headless: true });\n' +
      'const page = await browser.newPage();\n' +
      'await page.goto(\'http://localhost:7575\');\n' +
      'await page.waitForSelector(\'.agent-card\', { timeout: 15000 });\n' +
      'await page.screenshot({ path: \'/tmp/dashboard.png\', fullPage: true });\n' +
      'await browser.close();\n' +
      '```\n\n' +
      'Save as a `.mjs` file and run with `node script.mjs`. Playwright is installed ' +
      'as a project devDependency so `import \'playwright\'` resolves correctly.',
  },
};

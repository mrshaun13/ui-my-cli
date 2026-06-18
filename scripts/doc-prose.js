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
    title: 'Codex Dashboard',
    tagline:
      'A browser-based dashboard for managing multiple Codex CLI agent sessions. ' +
      'Replaces tab-hunting with a click-driven UI: real embedded terminals, ' +
      'live status badges, analytics, and one-click agent switching.',
  },

  features: [
    '**Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds',
    '**Real terminals** — xterm.js + node-pty: identical to running `codex resume` in your shell',
    '**Click to switch** — click any agent in the sidebar to attach its live terminal; ' +
      'switching is instant with scrollback preserved',
    '**New session** — floating "+" button in the sidebar lets you start a new Codex session ' +
      'in any previously-used repo; the terminal opens automatically',
    '**Session preview** — click the status badge to open a read-only view of any session\'s ' +
      'chat history without spawning a PTY',
    '**Inline rename** — double-click any session title to rename it ' +
      '(stored in the dashboard metadata database; Codex internals stay read-only)',
    '**Needs-your-input filter** — one click to show only agents waiting for a reply',
    '**Repo filter pills** — filter sessions by project; selection persists across reloads',
    '**Hot/cold grouping** — recent sessions at top, old idle ones behind a configurable day divider',
    '**Archive / restore** — hide sessions from the list without deleting them; ' +
      'restore from the collapsible drawer at the bottom of the sidebar',
    '**Analytics dashboard** — activity heatmap, project combo chart (duration + turns + sessions), ' +
      'token usage, tool call breakdown, model distribution, shown when no session is selected',
    '**Context window pie chart** — per-session donut chart showing context window composition ' +
      '(system prompt, user messages, assistant messages, tool calls, tool results, free capacity)',
    '**Environment banner** — global config overview on the dashboard home page showing active ' +
      'model, MCP servers, skills, and plugins with color-coded chips',
    '**Session config** — per-session Codex metadata: source, model, reasoning effort, ' +
      'sandbox policy, approval mode, skills, plugins, and MCP servers where available',
  ],

  prerequisites: [
    '**Node.js 18+** — `node --version` to check',
    '**Codex CLI installed and run at least once** — creates the sessions database',
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
    'The server is a single Node.js process (Express + ws) that reads Codex local state ' +
    'from `~/.codex/state_*.sqlite` and rollout JSONL files under `~/.codex/sessions/`, ' +
    'then spawns node-pty processes bridged to browser-based xterm.js terminals. ' +
    'Codex-owned state is treated as read-only except for archive/restore through the Codex CLI.',

  data_flow: [
    'Codex CLI / VS Code  →  ~/.codex state DB + rollout JSONL  →  server polls every 3s  →  WebSocket push  →  React client',
    'Browser  →  xterm.js keystrokes  →  WebSocket  →  node-pty  →  codex resume <id>',
  ].join('\n'),

  conventions: [
    'Session status values are lowercase strings: `active`, `question`, `finished`, `idle`.' +
      ' The value `archived` is used by the API but not stored in the database.',
    'All server modules use CommonJS (`require` / `module.exports`).',
    'The client uses ES modules with React 19 + Vite.',
    'Codex archive state is changed through `codex archive` / `codex unarchive`. ' +
      'Dashboard-only title overrides are stored in `~/.codex/ui-my-cli-dashboard.db`.',
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
    'GET /api/status':               'Server health check — returns `ok`, active PTY count, uptime seconds',
    'GET /api/stats':                'Full dashboard analytics — activity, tools, tokens, MCP servers, skills, plugins',
    'GET /api/latest-prompt':        'Most recent user prompt from Codex local thread state',
    'GET /api/sessions':             'List all active (non-archived) sessions with derived status',
    'GET /api/sessions/archived':    'List archived (hidden) sessions',
    'GET /api/sessions/search':      'Full-text session search — query param `q` (required), `archived=1` to include archived sessions. Searches title, working directory, prompt history, and user-role message content. Returns same shape as the sessions list.',
    'GET /api/repos':                'List all unique repos (working directories) from past sessions',
    'POST /api/sessions/create':     'Start a new Codex session in the given working directory (body: `{ workingDir: string }`); returns `{ sessionId }`',
    'GET /api/sessions/:id/preview': 'Rich read-only session detail — chat history, stats, top tools',
    'GET /api/sessions/:id/conversation': 'Paginated user↔assistant conversation turns for a session. Query params: `offset` (number of turns to skip from end, default 0), `limit` (max turns to return, 0 = all, default 50). Returns `{ turns, totalTurns, hasMore }`.',
    'GET /api/sessions/:id/subagents': 'Reserved for linked Codex subagent/review thread data. Returns an array; v1 returns `[]`.',
    'GET /api/sessions/:id/context': 'Estimated context breakdown for a Codex session based on rollout JSONL message and tool content. Returns `{ categories, totalUsed, maxContext, freeTokens, compactionCount, model }`.',
    'GET /api/sessions/:id/config': 'Per-session Codex configuration metadata. Returns `{ rules, activeSkills, permissions, model, permissionMode }`.',
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
    CODEX_HOME:              'Override the Codex home directory (default: `~/.codex`)',
    CODEX_STATE_DB_PATH:     'Override the auto-detected Codex state SQLite database path',
    UI_MY_CLI_DB_PATH:       'Override the dashboard metadata database path',
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
      'At least one Codex CLI session must exist (run `codex` once) — tests interact with session cards',
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
        '"No sessions found" until the `/ws/status` WebSocket delivers the first `sessions` message ' +
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

# AGENTS.md — Contributor & AI Agent Guide

## Project Summary

A browser dashboard for managing multiple local headless-agent sessions across Codex and Devin, plus a browser-free native frontend for Windows and macOS. Both surfaces share persistent server PTYs, live status, analytics, search, and session metadata; the native surface renders terminals through an Avalonia PTY view and can reattach after the UI exits.

**Stack:** Node.js >=18.0.0 · Express · WebSocket (`ws`) ·
`better-sqlite3` · `node-pty` · React 19 · Vite · xterm.js

## Build & Run Commands

- `npm run build` — `cd client && npm run build`
- `npm run start` — `NODE_ENV=production node server/index.js`
- `npm run pm2:start` — `npm run build && pm2 start ecosystem.config.cjs`
- `npm run pm2:restart` — `npm run build && pm2 restart codex-dashboard`
- `npm run pm2:stop` — `pm2 stop codex-dashboard`
- `npm run pm2:logs` — `pm2 logs codex-dashboard`
- `npm run postinstall` — `npm --prefix client ci`
- `npm run docs` — `node scripts/generate-docs.js`
- `npm run docs:check` — `node scripts/generate-docs.js --check`
- `npm run test` — `npx playwright test`
- `npm run test:unit` — `node --test tests/unit/*.test.js`
- `npm run test:smoke` — `npx playwright test tests/smoke.spec.js`
- `npm run native:build` — `dotnet build native/CodexNative/CodexNative.csproj && dotnet build native/CodexNative.TerminalHost/CodexNative.TerminalHost.csproj && dotnet build native/CodexNative.Updater/CodexNative.Updater.csproj`
- `npm run native:version:check` — `node scripts/check-native-version.mjs`
- `npm run native:test` — `dotnet run --project native/CodexNative.CommandTests/CodexNative.CommandTests.csproj`
- `npm run native:verify-artifacts` — `dotnet run --project native/CodexNative.CommandTests/CodexNative.CommandTests.csproj -- --verify-release-artifacts native/artifacts/releases`
- `npm run native:publish` — `npm run native:publish:win && npm run native:publish:mac`
- `npm run native:publish:win` — `bash scripts/publish-native.sh win-x64`
- `npm run native:publish:mac` — `bash scripts/publish-native.sh osx-x64 && bash scripts/publish-native.sh osx-arm64`
- `npm run native:package` — `python3 scripts/package-native-release.py win-x64 osx-x64 osx-arm64`
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
| `server/providers/index.js` | Provider registry, default provider, provider metadata |
| `server/codex-store.js` | Core Codex session data model, status detection, archive logic |
| `server/providers/devin/store.js` | Legacy Devin session data model, status detection, archive logic |
| `server/index.js` | All REST endpoints, WebSocket protocol, broadcast logic |
| `client/src/hooks/useStatusFeed.js` | How the client receives live session updates |
| `client/src/components/Terminal.jsx` | xterm.js + PTY WebSocket bridge |
| `server/pty-manager.js` | node-pty lifecycle, scrollback buffer, WSL env handling, Unix spawn-helper executable repair |
| `native/CodexNative/MainWindow.axaml.cs` | Native Agent provider switcher, provider-scoped tabs, analytics, and preferences |
| `native/CodexNative/DashboardApiClient.cs` | Provider-scoped native REST/WebSocket client for the loopback dashboard API |
| `scripts/doc-prose.js` | Editorial prose for auto-generated docs |

## Status Values (Canonical)

These are the only valid status strings in the system, returned by provider
status adapters. Use them consistently across all client components.

| Value | Meaning |
|-------|---------|
| `active` | Tool calls in flight, or activity within the last 60 seconds |
| `question` | Agent's last message ends with `?` — waiting for your reply |
| `finished` | Agent stopped without a question — task done or paused |
| `idle` | No activity for more than 10 minutes |

The value `archived` is used at the API layer to mean "hidden from the active
list". Archive behavior is provider-owned: Codex uses `codex archive` /
`codex unarchive`; Devin uses dashboard-local archive metadata.

## Session Object Shape

```js
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
```

## Key Conventions

- Session status values are lowercase strings: `active`, `question`, `finished`, `idle`. The value `archived` is used by the API but not stored in the database.
- All server modules use CommonJS (`require` / `module.exports`).
- The client uses ES modules with React 19 + Vite.
- The native Windows/macOS frontend uses .NET 10, Avalonia, and an XTerm-compatible native PTY control; it does not embed a browser. Local provider APIs and provider-scoped WebSockets carry metadata and terminal streams only over loopback. The native Agent selector persists `ProviderId` in `CodexNative/settings.json` and stores each pane tab's `ProviderId` so open tabs reattach to the correct provider after reloads and provider switches.
- Native desktop releases are versioned by `Directory.Build.props`; every artifact is named `CodexNative-v<version>-<runtime>.zip`. Stable `vX.Y.Z` tags must match that version. A matching tag, or an explicit `publish_release=true` workflow dispatch on `main`, publishes immutable Windows x64, macOS Intel, and macOS Apple Silicon ZIP/checksum pairs to GitHub Releases. GitHub Packages is intentionally not used for generic desktop archives.
- The portable Windows native release belongs under `%LOCALAPPDATA%\Programs\CodexNative`, not Desktop, Downloads, OneDrive, or a network-synchronized directory. Users must verify the GitHub release SHA-256 before using Windows Properties to unblock each currently unsigned executable; organization security policy must not be bypassed. Keep all three executables together so in-place update, rollback, restart, and taskbar shortcuts remain valid.
- Provider routes are scoped as `/api/:providerId/...` and `/ws/:providerId/...`; legacy `/api/...` and `/ws/...` aliases point to the default provider (`codex`).
- Codex archive state is changed through `codex archive` / `codex unarchive` for native Codex sessions. Native Codex titles are stored in Codex `state_*.sqlite`; external transcript-pipeline headless title and hide/restore metadata is stored in `~/.codex/ui-my-cli-dashboard.db`.
- Devin archive state remains dashboard-local in the Devin dashboard metadata database next to Devin `sessions.db`.
- Production: `npm start` — must run `npm run build` first.
- Development: `node --watch server/index.js` + `cd client && npm run dev`.
- **PM2 caveat** — PM2 keeps the old process in memory until explicitly restarted. After any server-side code change, always run `npm run pm2:restart` (which rebuilds the client and restarts the process). A bare `npm run build` is **not enough** — the running Node process still executes the old code.
- **Plan artifacts** — Files under `plans/` are working documents and must remain local/untracked by default. Do not stage or commit a plan unless the user explicitly asks for that specific plan to be committed. A generated or review plan is not release content.

## Decision-Making Philosophy

This is a **single-user, single-developer project**. The sole consumer is the person who built it. That changes the calculus on every decision:

- There is no legacy team to retrain, no migration guide to write, no deprecation cycle.
- Breaking changes are free — the user will simply rebuild and restart.
- "Correct" means "best long-term outcome for this one person," not "safest for a committee."

### Principles

- **Challenge the premise before implementing.** When asked to add a feature or fix a bug, first ask: is the current architecture the right foundation for this change? If the underlying abstraction is wrong, patching on top just creates well-organized tech debt. Propose the structural fix, explain the trade-off, and let the user decide.
- **"Best possible" over "least disruptive."** Do not default to the smallest diff. Evaluate whether a larger refactor would leave the codebase in a fundamentally better state. If so, present that option (with effort estimate) alongside the minimal fix. The user can always choose the quick path, but they should know the better one exists.
- **Technology choices are not sacred.** If a library, pattern, or architectural decision is the wrong tool for where the project is heading, say so. Sorted and well-organized "wrong tech" is still wrong tech. Propose the migration path and let the user weigh the cost.
- **Think in trajectories, not snapshots.** Each change shapes what future changes are easy or hard. Prefer changes that open up future possibilities over those that close them off, even if the immediate task doesn't require it.
- **Explain the "why" behind the recommendation.** The user wants to learn and make informed decisions. Don't just say "I recommend X" — explain what makes X better than the alternatives and what you'd lose by choosing them.

### Pre-Implementation Checklist

Before writing code, run through these questions:

- Is the current abstraction the right one, or am I papering over a design gap?
- Would a different data model, component structure, or API shape make this and *future* changes simpler?
- Am I reaching for a pattern because it's familiar, or because it's optimal for this project?
- If I were starting this feature from scratch today, would I build it the same way?
- What does this change make easier to do next? What does it make harder?

## Adding a New REST Endpoint

1. Add `app.METHOD('/api/:providerId/path', handler)` in `server/index.js`
2. Resolve provider behavior through `server/providers/index.js`
3. If it mutates session data, call `broadcastSessions(provider.id)` to push an update
4. Add the description to `scripts/doc-prose.js` under `routeDescriptions`
5. Run `npm run docs` — the API reference auto-updates

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

## Testing (Playwright E2E)

E2E tests use **Playwright** (Chromium only) and run against the **live PM2-managed server** on port 7575. There is no `webServer` block in the Playwright config — tests expect the dashboard to already be running. This matches the real production setup and avoids port conflicts with PM2.

### Prerequisites

- Dashboard running via PM2: `npm run pm2:start` (or confirm with `pm2 list`)
- At least one Codex CLI session must exist (run `codex` once) — default-provider tests interact with session cards
- Playwright browsers installed: `npx playwright install chromium` (one-time setup)

### Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run the full Playwright test suite |
| `npm run test:smoke` | Run only the smoke tests (fastest sanity check) |
| `npx playwright test <file>` | Run a single test file |
| `npx playwright test --ui` | Open the interactive Playwright UI |
| `npx playwright show-report` | Open the last HTML test report |

### Gotchas & Pitfalls

- **Server must be running first.** Tests do NOT start the server — they hit `localhost:7575` served by PM2. If the server is down, tests fail with a clear message: "Dashboard not reachable... Start it first: npm run pm2:start".
- **Session cards arrive via WebSocket**, not in the initial HTML. The sidebar renders "No sessions found" until the provider-scoped `/ws/:providerId/status` WebSocket delivers the first `sessions` message (up to 3 seconds). Use `waitForSessions(page)` from `tests/helpers.js` instead of a bare `page.goto("/")` when you need session cards.
- **After server code changes**, run `npm run pm2:restart` (not just `npm run build`). PM2 keeps the old process in memory.
- **Port override:** Set `PORT=XXXX` before running tests if the server is on a non-default port. The Playwright config and helpers both read `process.env.PORT`.
- **Chromium only.** Firefox and WebKit are not installed. The Playwright config has a single `chromium` project. Run `npx playwright install` to add other browsers.
- **Serial live-service tests.** Playwright intentionally uses one worker locally and in CI because the suite shares one PM2 service and persistent PTY state; parallel workers can race terminal and navigation assertions.

### Writing New Tests

- Put test files in `tests/` with the `.spec.js` extension.
- Import helpers: `import { ensureServerRunning, waitForSessions, SELECTORS } from './helpers.js'`
- Always call `test.beforeAll(ensureServerRunning)` — it validates the server is reachable and fails fast with a helpful message instead of cryptic connection timeouts.
- Use `waitForSessions(page)` to navigate and wait for session cards to appear (handles the WebSocket timing automatically).
- Use `SELECTORS` from helpers for consistent CSS selectors across all tests. If you add a new UI element, add its selector to `SELECTORS` so other tests can use it.
- Failure screenshots are saved automatically to `test-results/` (gitignored).

### Test File Inventory

| File | Description |
|------|-------------|
| `playwright.config.js` | Playwright config — baseURL, reporter, project (Chromium) |
| `tests/helpers.js` | Shared test utilities — `ensureServerRunning`, `waitForSessions`, `SELECTORS` |
| `tests/smoke.spec.js` | Smoke tests — server health, sidebar rendering, terminal open, search |

### Ad-Hoc Visual Testing

For quick visual checks without writing a spec file, you can use Playwright's API directly via a one-off Node.js script. This is useful for debugging UI issues:

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:7575');
await page.waitForSelector('.agent-card', { timeout: 15000 });
await page.screenshot({ path: '/tmp/dashboard.png', fullPage: true });
await browser.close();
```

Save as a `.mjs` file and run with `node script.mjs`. Playwright is installed as a project devDependency so `import 'playwright'` resolves correctly.

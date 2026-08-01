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
- `npm run test` — `npm run test:e2e:isolated`
- `npm run test:e2e:isolated` — `npm run build && playwright test`
- `npm run test:unit` — `node --test tests/unit/*.test.js`
- `npm run test:smoke` — `npm run build && playwright test tests/smoke.spec.js`
- `npm run native:build` — `dotnet build native/CodexNative/CodexNative.csproj && dotnet build native/CodexNative.TerminalHost/CodexNative.TerminalHost.csproj && dotnet build native/CodexNative.SpeechHost/CodexNative.SpeechHost.csproj && dotnet build native/CodexNative.Updater/CodexNative.Updater.csproj`
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
| `Directory.Build.props` | Native version source of truth (`Version` / assembly / file versions) for packaging and CI |
| `CHANGELOG.md` | Hand-edited release notes under `## Unreleased` — required on every user-facing native PR |
| `scripts/doc-prose.js` | Editorial prose for auto-generated docs |
| `native/README.md` | Native install, update contract, and platform notes (hand-edited) |

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
- **Release hygiene is mandatory on every user-facing native PR** — see **Native release process** below. At minimum: bump `Directory.Build.props`, add bullets under `CHANGELOG.md` → `## Unreleased`, update release-facing docs (`native/README.md` / `scripts/doc-prose.js` as needed), run `npm run docs` and `npm run native:version:check`. A PR that ships native behavior without a version + changelog entry is incomplete.
- The portable Windows native release belongs under `%LOCALAPPDATA%\Programs\CodexNative`, not Desktop, Downloads, OneDrive, or a network-synchronized directory. Users must verify the GitHub release SHA-256 before using Windows Properties to unblock each currently unsigned executable; organization security policy must not be bypassed. Keep all four executables together so terminal bridging, local speech, in-place update, rollback, restart, and taskbar shortcuts remain valid.
- Never commit local tool caches under `.tools/`, NuGet/HTTP caches, or SDK installs. Keep `.tools/` gitignored. Accidental commits of these trees break GitHub PR file views (often showing 0 files changed) and must be purged before merge.
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
- If this touches native desktop, server PTY, packaging, or user-visible behavior: did I bump `Directory.Build.props` and update `CHANGELOG.md` under Unreleased?

## Native release process

User-facing native (and related server) work is not done when the feature compiles. Every PR that changes shippable desktop behavior must leave the tree ready for a versioned GitHub Release: version source of truth, changelog entry, release docs, and clean CI artifacts. `CHANGELOG.md` is hand-edited (not auto-generated). `Directory.Build.props` is the only native version source used by packaging and CI.

### When a PR must follow this process

- Any change under `native/` that users will receive via the desktop app or updater.
- Server/PTY/API changes the native app or updater depends on for a correct release.
- Packaging, CI release workflow, `scripts/publish-native.sh`, or `scripts/package-native-release.py` changes.
- Docs that describe install, update, portable paths, signing, or release contract changes.

### PR checklist (do these before merge)

- **Bump the native version** in `Directory.Build.props` (`Version`, `AssemblyVersion`, `FileVersion` together). Patch for fixes; minor for features; major only for intentional breaks. Stacked PRs each get their own bump if they ship separately (e.g. 1.1.5 then 1.1.6).
- **Update `CHANGELOG.md`** under `## Unreleased` with a new `### Native desktop X.Y.Z` (or Documentation) section matching that version. Write user-visible bullets: what changed, why it matters, remaining non-goals. Do not leave Unreleased empty for a version you just bumped.
- **Sync release-facing docs**: update `native/README.md` when install/update/validation steps change; put browser/agent prose in `scripts/doc-prose.js` and run `npm run docs` so `README.md` / `AGENTS.md` / `docs/*` stay in sync.
- **Run `npm run native:version:check`** so the three-part version parses; CI uses the same source.
- **Do not commit `.tools/`**, NuGet caches, or SDK trees. Confirm `git status` and PR file count look sane before push.
- **Native desktop CI** on the PR must build win-x64 / osx-x64 / osx-arm64 and run per-RID `native:verify-artifacts`. Green Actions artifacts are validation only—not the public release.

### Publishing a stable release (after merge to `main`)

1. Merge the PR to `main` only after version + changelog + docs + CI are complete.
2. Publish a stable release in either controlled way: (1) push exact tag `vX.Y.Z` matching `Directory.Build.props`, or (2) run **Native desktop** workflow on `main` with `publish_release=true` (creates matching tag + release).
3. Confirm GitHub Releases has `CodexNative-vX.Y.Z-{win-x64,osx-x64,osx-arm64}.zip` plus `.sha256` manifests. Existing releases are immutable—never reuse a version number.
4. Optional: after publish, move the released section out of `## Unreleased` into a dated heading if you want a frozen historical section (keep Unreleased for the next cycle).

### Non-goals / traps

- PR Actions artifacts are not production installs; only tagged / `publish_release` GitHub Releases are.
- GitHub Packages is not used for desktop ZIPs.
- macOS signing and notarization remain separate from the version/changelog process until those pipelines exist.

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
`AGENTS.md`) is auto-generated. **Never edit those files directly**, except
for the marker-bounded multi-agent workflow block in `AGENTS.md`; changes
outside that block will be overwritten on the next `npm run docs` run.

To update docs:
1. Change source code or edit `scripts/doc-prose.js` (for prose/descriptions)
2. Run `npm run docs`
3. Commit both the code change and the regenerated docs together

The pre-commit hook runs `npm run docs:check` and blocks the commit if any
generated doc is out of sync with the current source.

The marker-bounded multi-agent workflow block is maintained separately and
preserved verbatim by the documentation generator. Duplicate, incomplete, or
reversed boundary markers make generation fail instead of silently discarding
instructions.

## Testing (Playwright E2E)

E2E tests use **Playwright** (Chromium only) against a processless synthetic dashboard on a dedicated loopback port. Playwright starts and stops the fixture server automatically. The fixture provides deterministic providers, sessions, analytics, previews, and terminal output without importing production databases, PTYs, provider CLIs, native launchers, or filesystem watchers.

### Prerequisites

- Project dependencies installed with `npm ci`
- Playwright browsers installed: `npx playwright install chromium` (one-time setup)
- No PM2 service or real Codex/Devin session is required

### Commands

| Command | Description |
|---------|-------------|
| `npm test` | Build the client and run the isolated Playwright suite |
| `npm run test:e2e:isolated` | Build the client and run the isolated Playwright suite explicitly |
| `npm run test:smoke` | Build the client and run only the isolated smoke tests |
| `npm run test:e2e:isolated -- --ui` | Open the isolated suite in Playwright UI mode |
| `npx playwright show-report` | Open the last HTML test report |

### Gotchas & Pitfalls

- **Never point Playwright at port 7575.** The config refuses the production port, starts the fixture with `reuseExistingServer: false`, and verifies the synthetic runtime marker and fixed session IDs before testing.
- **Session cards arrive via WebSocket**, not in the initial HTML. The sidebar renders "No sessions found" until the provider-scoped `/ws/:providerId/status` WebSocket delivers the first `sessions` message from the fixture. Use `waitForSessions(page)` from `tests/helpers.js` instead of a bare `page.goto("/")` when you need session cards.
- **Isolation guards are part of the contract.** The fixture fails if code imports `node-pty`, `better-sqlite3`, the real provider/PTY/native-launch modules, `child_process`, or filesystem watches.
- **Port override:** Set `PLAYWRIGHT_PORT=XXXX` to change the isolated loopback port. Port 7575 is always rejected.
- **Chromium only.** Firefox and WebKit are not installed. The Playwright config has a single `chromium` project. Run `npx playwright install` to add other browsers.
- **Synthetic data only.** Tests must assert fixed synthetic session IDs and terminal output. Never add a fixture fallback that reads local provider state or resumes a real terminal.

### Writing New Tests

- Put test files in `tests/` with the `.spec.js` extension.
- Import helpers: `import { ensureIsolatedServer, assertIsolationGuards, waitForSessions, SELECTORS } from './helpers.js'`
- Always call `test.beforeAll(ensureIsolatedServer)` and `test.afterAll(assertIsolationGuards)`.
- Use `waitForSessions(page)` to navigate and wait for session cards to appear (handles the WebSocket timing automatically).
- Use `SELECTORS` from helpers for consistent CSS selectors across all tests. If you add a new UI element, add its selector to `SELECTORS` so other tests can use it.
- Failure screenshots are saved automatically to `test-results/` (gitignored).

### Test File Inventory

| File | Description |
|------|-------------|
| `playwright.config.js` | Isolated Playwright server, baseURL, reporters, and Chromium project |
| `tests/helpers.js` | Isolation verification, WebSocket session waiting, and shared selectors |
| `tests/fixtures/` | Processless providers, terminal transport, launcher, and import/watch guards |
| `tests/smoke.spec.js` | Smoke tests — server health, sidebar rendering, terminal open, search |
| `tests/tabs.spec.js` | Two-session tab behavior, terminal persistence, preview, close, and reload coverage |

### Ad-Hoc Visual Testing

Use `npm run test:e2e:isolated -- --ui` for interactive visual debugging. This keeps the browser attached to the guarded synthetic runtime and stores failure artifacts under `test-results/`.

<!-- adopt-multi-agent-dev:start -->
## Multi-agent development workflow

### Project purpose
- Goal: Maintain a local browser dashboard and native Windows/macOS client for managing Codex and Devin sessions through shared REST/WebSocket contracts, persistent server-owned PTYs, status, search, analytics, and session metadata.
- Primary users/operators: The documented primary user and operator is the single developer who built the project; downstream systems include local Codex and Devin state, PM2, browser clients, and the Avalonia desktop application.
- Lifecycle stage: Production overall, with the native frontend documented as a development preview and macOS documented as experimental.
- Canonical evidence: `README.md`, `docs/architecture.md`, `native/README.md`, `.github/workflows/native-release.yml`, and `Directory.Build.props`.
- Unresolved: Confirm whether the production classification includes the preview native/macOS surfaces when that distinction would change task risk or release verification.

### Orchestration
- The main thread owns requirements, the plan, shared state, integration, user decisions, and the final response.
- Delegate only concrete, bounded, independently useful work with explicit inputs, outputs, ownership, and verification.
- Prefer parallel read-only discovery. Use one writer for overlapping files; multiple writers require isolated worktrees and disjoint ownership.
- Wait for required agent results and reconcile them against repository evidence before integrating changes.

### Agent selection
- Start in the main thread and activate only the roles justified by safe independent workstreams.
- Use the built-in explorer for read-heavy architecture, dependency, and command discovery.
- Use the built-in worker for assigned implementation after acceptance criteria and file ownership are clear.
- Use the project reviewer after material changes and for high-risk analysis.
- Project concurrency cap: 4 spawned threads because recurring read/review lanes exist for server/provider code, browser code, native code, and tests/release documentation. Normal tasks should use only 2–3 active agents.
- Conditional roles:
  - `test_analyst`: activate for changes involving tests, PTYs, session state, browser/native integration, or CI.
  - `release_reviewer`: activate for native, updater, packaging, release workflow, server/native contract, or release-facing documentation changes.
  - `security_reviewer`: activate for process or PTY launch, mutable endpoints, provider storage, downloads, updates, external URLs, filesystem handling, or another trust boundary.
- API compatibility remains part of reviewer/release-reviewer scope; UI accessibility remains a task-specific review prompt until project-specific tooling justifies a separate role.
- Archivist: not installed because Git history, generated architecture/API documentation, the changelog, tests, and tracked plans currently reconstruct state without a second canonical memory layer.

### Ownership and result contract
- Do not let agents edit the same files concurrently without isolated worktrees and explicit ownership.
- Workers return: result, evidence, files touched, checks run, confidence, and open questions.
- Reviewers return exactly one verdict—`PASS`, `REPAIR`, `REPLAN`, or `ESCALATE`—followed by concrete evidence and the smallest next action.
- Read-only specialists do not start services, inspect real session contents, access secrets, or take external actions.

### Verification and stopping
- Always run `node scripts/generate-docs.js --check` and `node scripts/check-native-version.mjs` for workflow or generated-instruction changes.
- The dependency-free baseline is `node --test tests/adaptiveRouter.test.mjs tests/codexControlPlane.test.mjs tests/codexShortcuts.test.mjs tests/nativeLauncher.test.mjs tests/pendingSessionTracker.test.mjs tests/unit/codex-executable.test.js tests/unit/codex-token-activity.test.js tests/unit/codex-usage-rollups.test.js`.
- Run the broader Node, Playwright, .NET, build, packaging, or artifact checks only when the task requires them and their documented dependencies and isolation conditions are satisfied. The default Playwright suite is isolated: it starts a guarded synthetic dashboard on a dedicated loopback port and must never import provider databases, real PTYs, provider CLIs, native launchers, or filesystem watchers.
- Limit review/repair to two loops.
- Stop when acceptance criteria pass, the loop limit or budget is reached, a new failure appears, or user input or permission is required.
- Preserve unrelated and pre-existing changes.

### Production safety
- Begin production workflow adoption in audit-only mode and write only after explicit approval on a clean non-default feature branch or isolated worktree.
- Record the baseline commit and safe check results before adoption and compare the same checks after adoption.
- Keep the adoption commit limited to `AGENTS.md` and `.codex` workflow configuration and role profiles; add a canonical memory layer only after separate approval and evidence that the archivist gate passes.
- Do not modify application code, dependencies, tests, CI, deployment, infrastructure, migrations, generated artifacts, or production data during workflow adoption.
- Do not push, merge, deploy, release, access production data, or alter production systems without separate explicit authorization.
- Roll back the isolated adoption commit with `git revert --no-edit` followed by the verified adoption commit hash reported in the adoption handoff.
- Treat rollback as tracked-file recovery; compare the original safe checks afterward and inspect any generated or ignored artifacts separately.
- Do not begin product development under the adopted workflow until the user accepts the verified adoption commit. Rollback cannot undo later decisions or commits influenced by these instructions, and later edits can make a revert conflict.
<!-- adopt-multi-agent-dev:end -->

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
      'plus a browser-free native frontend for Windows and macOS. Both surfaces share persistent server PTYs, ' +
      'live status, analytics, search, and session metadata; the native surface renders terminals through ' +
      'an Avalonia PTY view and can reattach after the UI exits.',
  },

  features: [
    '**Live status badges** — ⚡ Question / ⚙ Running / ✓ Finished / · Idle, updated every 3 seconds',
    '**Provider switch** — top-level Codex / Devin toggle in the browser and native Agent selector; sessions, repo filters, tabs, stats, archives, and terminals are scoped to the selected provider on both surfaces',
    '**Native Windows and macOS frontend (development preview)** — Avalonia dashboard with a persistent Agent provider switcher (`/api/providers`), provider-scoped REST/WebSocket/tabs/session actions, cached verified release checks, deferred crash-safe conversation search, a compact functional project/age/visibility filter, actionable rich previews, responsive header and pane sizing, theme-aware control chrome and pane scrollbars, a custom pixel-art app identity, a rich compact session rail, a searchable agent-or-local-shell project launcher, automatic terminal-bridge reconnect, terminal selection and scrollback copy controls, toggleable keyboard-accessible cohort analytics (Codex credit rollups only when Codex is selected), latest-prompt navigation, context composition, Codex subagent timelines, keyboard shortcuts, provider/quota health, and persistent provider terminal reattachment; the current desktop package still requires a prepared local ui-my-cli checkout and is not a standalone distribution, while macOS signing, notarization, and production updater distribution remain incomplete and macOS must be treated as experimental',
    '**Real terminals** — xterm.js + node-pty: identical to running the selected provider CLI in your shell (`codex resume <id>` or `devin --resume <id>`)',
    '**Native terminal selection** — plain drag selects text even when an agent TUI enables mouse reporting; `Ctrl+C` copies on Windows/Linux, `Cmd+C` copies on macOS, macOS `Ctrl+C` remains SIGINT, and `Alt`+drag sends raw mouse input to the TUI',
    '**Click to switch** — click any agent in the sidebar to attach its live terminal; ' +
      'switching is instant with scrollback preserved',
    '**New session** — floating "+" button in the sidebar lets you start a new Codex or Devin session ' +
      'in any previously-used repo; the temporary terminal remains available until it safely correlates to a persisted provider session',
    '**Session preview** — click the status badge to open a read-only view of any session\'s ' +
      'chat history without spawning a PTY',
    '**Inline rename** — double-click any session title to rename it ' +
      '(new titles are limited to 160 characters; constrained native views compact only legacy titles; native Codex titles are written to Codex state so CLI, VS Code, and this dashboard stay aligned; external headless titles use dashboard metadata)',
    '**Needs-your-input filter** — one click to show only agents waiting for a reply',
    '**Project filter** — compact count-labelled project selection replaces the unbounded native pill wall; selection persists across reloads',
    '**Persistent native terminals** — provider-scoped PTYs stay in the independent dashboard service when the desktop UI closes; reopening the native app reattaches with buffered scrollback. On macOS the private service is launched through `nohup`, window close hides to the menu bar, and the menu-bar icon can reopen, reconnect, stop an idle app-managed service, or quit',
    '**Instant Adaptive switching** — compatible native Codex PTYs stay connected through one app-server control plane while each pane independently switches between native Adaptive routing and direct TUI prompting without restarting or replaying the terminal; existing direct or fallback PTYs stay running and report Adaptive as unavailable instead of being restarted or migrated',
    '**Durable blank terminals and live context** — newly opened Codex tabs remain available until their first prompt persists the thread, while open native inspectors follow model, reasoning-effort, and context changes from manual `/model` selection or Adaptive routing',
    '**Project-root-safe native sessions** — each new Codex TUI receives the directory selected in the native chooser as an explicit working root, including when it connects through the shared app-server control plane',
    '**Local native voice-to-text** — each native terminal has a microphone control that captures through a dedicated cross-platform audio helper, trims speech with Silero VAD, transcribes locally with Whisper base.en, and inserts the result into either terminal input or the initiating pane\'s Adaptive composer without auto-submitting',
    '**Verified native updates** — cached and ETag-revalidated stable GitHub Release checks verify exact package size and SHA-256, wait up to two minutes for dashboard-tracked active provider sessions and local shells to drain, retain quiet Codex turns as blockers while their rollout is explicitly in flight, then hand the exact private-service PID, loopback endpoint, and instance identity to an external rollback-capable helper that revalidates all provider activity and active PTYs before graceful service shutdown, holds an install-scoped lock through replacement and rollback, transfers that lock to the replacement through framework initialization and its ready handshake, and leaves every unrelated process untouched',
    '**Hot/cold grouping** — recent sessions at top, old idle ones behind a configurable day divider',
    '**Archive / restore** — hide sessions from the list without deleting them; ' +
      'restore from the collapsible drawer at the bottom of the sidebar',
    '**Analytics dashboard** — activity heatmap, project combo chart (duration + turns + sessions), ' +
      '24-hour through all-time token and estimated-credit rollups by model, project, and session, tool call breakdown, model distribution, and Codex stats cohort switching, shown when no session is selected',
    '**Transparent Codex credit estimates** — session and dashboard summaries apply the published per-million-token Codex Standard-mode rate card to fresh input, cached input, and output tokens, show pricing coverage, leave unpublished model aliases unpriced, and explain that reasoning tokens are already billed as output rather than through a separate effort multiplier; Fast-mode multipliers are not guessed because stored telemetry does not identify that mode',
    '**Context window pie chart** — per-session donut chart showing context window composition ' +
      '(system prompt, user messages, assistant messages, tool calls, tool results, free capacity)',
    '**Environment banner** — global config overview on the dashboard home page showing active ' +
      'model, MCP servers, skills, and plugins with color-coded chips',
    '**Session config** — per-session provider metadata: source, model, reasoning effort, ' +
      'sandbox policy, approval mode, skills, plugins, and MCP servers where available',
  ],

  prerequisites: [
    '**Node.js 18+** — `node --version` to check',
    '**.NET 10 SDK** — optional; required only to build or publish the native Windows/macOS frontend',
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
    '- `vite` pinned to `6.4.3` in `client/package.json` (fixes the WebSocket ' +
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
    'The React client and the Avalonia native shell each expose a hard provider switch so Codex and Devin sessions never mix in one dashboard view; both load the catalog from `/api/providers` and scope list/search/stats/archive/PTY traffic to the selected provider. ' +
    'The Codex provider can also read transcript-pipeline headless ledgers that explicitly record `runtime_metadata.agent_id = "codex"`; those external runs stay read-only and are surfaced as transcript-pipeline headless sessions. ' +
    'New browser sessions start on a temporary PTY key, then re-key only after exact Codex originator correlation or one uniquely identifiable Devin candidate created after the PTY starts confirms ownership; every live pending PTY survives client detachment until its process exits or the user explicitly cancels it. A collision keeps separate canonical metadata and temporary terminal transport identities so neither browser terminal is discarded. Synthetic Codex context envelopes are excluded from user-prompt metadata. New session titles are limited to 160 characters, while legacy oversized titles and native prompt previews are normalized to bounded single-line display text. The cross-platform native frontend uses Avalonia for the dashboard and a native PTY terminal control for rendering. Its console bridge attaches provider-scoped session tabs to the same buffered server PTYs as the browser, so sessions can outlive either UI. Tabs and previews retain their provider identity across switches; native settings persist the selected provider and each pane tab\'s provider. A separate on-demand speech helper owns microphone capture, Silero VAD, and local Whisper transcription so audio and model faults cannot destabilize the dashboard process. Windows keeps provider CLIs and project files in WSL2; macOS uses the local Node service and provider state, recovers a ready ui-my-cli checkout with installed Node dependencies when a configured path is stale, launches its private service through `nohup`, and exposes a menu-bar lifecycle for hide/reopen/stop/quit. Non-Codex analytics omit Codex-only credit rollups and pricing telemetry. The Node PTY manager self-heals a missing executable bit on node-pty\'s Unix spawn-helper before spawn. Direct login-shell tabs run in validated project paths and end when their tab or the application closes. Native updates cache and ETag-revalidate platform release metadata, report rate-limit reset times, verify their SHA-256 manifests, stage outside the installation, wait at most two minutes for dashboard-tracked active sessions and local shells to drain, retain quiet Codex turns as blockers while their rollout is explicitly in flight, and hand replacement to an external helper with the exact owned private-service PID, loopback endpoint, and instance identity. The helper uses an authenticated readiness contract to revalidate that same service has no active provider sessions or PTYs immediately before requesting graceful shutdown, holds a target-specific lock through replacement and rollback, transfers the lock to the replacement through framework initialization and its ready handshake, leaves unrelated processes untouched, verifies the installed version, and reports the final result once on the next launch.',

  data_flow: [
    'Codex CLI / VS Code  →  ~/.codex state DB + rollout JSONL  →  Codex provider adapter  →  WebSocket push  →  React client / native app',
    'transcript-pipeline Codex headless ledger  →  data/headless-sessions status/events files  →  Codex provider external-read adapter  →  React client / native app',
    'Devin CLI  →  Devin sessions.db + dashboard.db  →  Devin provider adapter  →  WebSocket push  →  React client / native app',
    'Browser  →  xterm.js keystrokes  →  provider-scoped WebSocket  →  node-pty  →  selected provider resume command',
    'New-session POST  →  temporary PTY  →  exact Codex originator correlation / bounded Devin candidate  →  re-keyed provider session',
    'Native app Agent selector  →  GET /api/providers  →  provider-scoped /api/:providerId/* and /ws/:providerId/*',
    'Windows native app  →  Avalonia terminal control  →  ConPTY  →  console bridge  →  provider-scoped WebSocket  →  persistent WSL2 PTY  →  selected provider CLI',
    'Windows native app  →  Avalonia terminal control  →  ConPTY  →  validated WSL2 launch  →  Ubuntu login shell',
    'Windows native dashboard controls  →  localhost /api/:providerId  →  session/context/stats readers  →  selected provider state in WSL2',
    'Native microphone button  →  on-demand speech helper  →  16 kHz mono capture  →  Silero VAD  →  local Whisper base.en  →  terminal input or Adaptive composer',
    'macOS native app  →  Avalonia terminal control  →  local PTY  →  console bridge  →  provider-scoped WebSocket  →  persistent macOS PTY  →  selected provider CLI',
    'macOS native app  →  Avalonia terminal control  →  validated project path  →  local login shell',
  ].join('\n'),

  conventions: [
    'Session status values are lowercase strings: `active`, `question`, `finished`, `idle`.' +
      ' The value `archived` is used by the API but not stored in the database.',
    'All server modules use CommonJS (`require` / `module.exports`).',
    'The client uses ES modules with React 19 + Vite.',
    'The native Windows/macOS frontend uses .NET 10, Avalonia, and an XTerm-compatible native PTY control; it does not embed a browser. Local provider APIs and provider-scoped WebSockets carry metadata and terminal streams only over loopback. The native Agent selector persists `ProviderId` in `CodexNative/settings.json` and stores each pane tab\'s `ProviderId` so open tabs reattach to the correct provider after reloads and provider switches.',
    'Native desktop releases are versioned by `Directory.Build.props`; every artifact is named `CodexNative-v<version>-<runtime>.zip`. Stable `vX.Y.Z` tags must match that version. A matching tag, or an explicit `publish_release=true` workflow dispatch on `main`, publishes immutable Windows x64, macOS Intel, and macOS Apple Silicon ZIP/checksum pairs to GitHub Releases. GitHub Packages is intentionally not used for generic desktop archives.',
    'Native update checks are anonymous by default. `CODEX_NATIVE_GITHUB_TOKEN` is an optional launch-environment variable for GitHub API rate limits; the native update client uses no credential unless that variable is explicitly supplied.',
    '**Release hygiene is mandatory on every user-facing native PR** — see **Native release process** below. At minimum: bump `Directory.Build.props`, add bullets under `CHANGELOG.md` → `## Unreleased`, update release-facing docs (`native/README.md` / `scripts/doc-prose.js` as needed), run `npm run docs` and `npm run native:version:check`. A PR that ships native behavior without a version + changelog entry is incomplete.',
    'The portable Windows native release belongs under `%LOCALAPPDATA%\\Programs\\CodexNative`, not Desktop, Downloads, OneDrive, or a network-synchronized directory. Users must verify the GitHub release SHA-256 before using Windows Properties to unblock each currently unsigned executable; organization security policy must not be bypassed. Keep all four executables together so terminal bridging, local speech, in-place update, rollback, restart, and taskbar shortcuts remain valid.',
    'Never commit local tool caches under `.tools/`, NuGet/HTTP caches, or SDK installs. Keep `.tools/` gitignored. Accidental commits of these trees break GitHub PR file views (often showing 0 files changed) and must be purged before merge.',
    'Provider routes are scoped as `/api/:providerId/...` and `/ws/:providerId/...`; legacy `/api/...` and `/ws/...` aliases point to the default provider (`codex`).',
    'Codex archive state is changed through `codex archive` / `codex unarchive` for native Codex sessions. New titles are validated as 1-160 control-free characters. Native Codex titles are stored in Codex `state_*.sqlite`; external transcript-pipeline headless title and hide/restore metadata is stored in `~/.codex/ui-my-cli-dashboard.db`.',
    'Devin archive state remains dashboard-local in the Devin dashboard metadata database next to Devin `sessions.db`.',
    'Production: `npm start` — must run `npm run build` first.',
    'Development: `node --watch server/index.js` + `cd client && npm run dev`.',
    '**PM2 caveat** — PM2 keeps the old process in memory until explicitly restarted.' +
      ' After any server-side code change, always run `npm run pm2:restart`' +
      ' (which rebuilds the client and restarts the process).' +
      ' A bare `npm run build` is **not enough** — the running Node process still executes the old code.',
    '**Plan artifacts** — Files under `plans/` are working documents and must remain local/untracked by default. ' +
      'Do not stage or commit a plan unless the user explicitly asks for that specific plan to be committed. ' +
      'A generated or review plan is not release content.',
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
      'If this touches native desktop, server PTY, packaging, or user-visible behavior: did I bump `Directory.Build.props` and update `CHANGELOG.md` under Unreleased?',
    ],
  },

  // ── Native release process (AGENTS.md) ─────────────────────────────────────
  // Full checklist so agents do not ship native PRs without version/changelog/docs.

  release_process: {
    overview:
      'User-facing native (and related server) work is not done when the feature compiles. ' +
      'Every PR that changes shippable desktop behavior must leave the tree ready for a ' +
      'versioned GitHub Release: version source of truth, changelog entry, release docs, ' +
      'and clean CI artifacts. `CHANGELOG.md` is hand-edited (not auto-generated). ' +
      '`Directory.Build.props` is the only native version source used by packaging and CI.',

    when_required: [
      'Any change under `native/` that users will receive via the desktop app or updater.',
      'Server/PTY/API changes the native app or updater depends on for a correct release.',
      'Packaging, CI release workflow, `scripts/publish-native.sh`, or `scripts/package-native-release.py` changes.',
      'Docs that describe install, update, portable paths, signing, or release contract changes.',
    ],

    pr_checklist: [
      '**Bump the native version** in `Directory.Build.props` (`Version`, `AssemblyVersion`, `FileVersion` together). Patch for fixes; minor for features; major only for intentional breaks. Stacked PRs each get their own bump if they ship separately (e.g. 1.1.5 then 1.1.6).',
      '**Update `CHANGELOG.md`** under `## Unreleased` with a new `### Native desktop X.Y.Z` (or Documentation) section matching that version. Write user-visible bullets: what changed, why it matters, remaining non-goals. Do not leave Unreleased empty for a version you just bumped.',
      '**Sync release-facing docs**: update `native/README.md` when install/update/validation steps change; put browser/agent prose in `scripts/doc-prose.js` and run `npm run docs` so `README.md` / `AGENTS.md` / `docs/*` stay in sync.',
      '**Run `npm run native:version:check`** so the three-part version parses; CI uses the same source.',
      '**Do not commit `.tools/`**, NuGet caches, or SDK trees. Confirm `git status` and PR file count look sane before push.',
      '**Native desktop CI** on the PR must build win-x64 / osx-x64 / osx-arm64 and run per-RID `native:verify-artifacts`. Green Actions artifacts are validation only—not the public release.',
    ],

    publish_steps: [
      'Merge the PR to `main` only after version + changelog + docs + CI are complete.',
      'Publish a stable release in either controlled way: (1) push exact tag `vX.Y.Z` matching `Directory.Build.props`, or (2) run **Native desktop** workflow on `main` with `publish_release=true` (creates matching tag + release).',
      'Confirm GitHub Releases has `CodexNative-vX.Y.Z-{win-x64,osx-x64,osx-arm64}.zip` plus `.sha256` manifests. Existing releases are immutable—never reuse a version number.',
      'Optional: after publish, move the released section out of `## Unreleased` into a dated heading if you want a frozen historical section (keep Unreleased for the next cycle).',
    ],

    non_goals: [
      'PR Actions artifacts are not production installs; only tagged / `publish_release` GitHub Releases are.',
      'GitHub Packages is not used for desktop ZIPs.',
      'macOS signing and notarization remain separate from the version/changelog process until those pipelines exist.',
    ],
  },

  // Descriptions for REST routes — keyed as "METHOD /path"
  routeDescriptions: {
    'GET /api/native/compatibility': 'Fast native startup probe — returns API version, service instance identity, and active PTY count without database or provider CLI checks.',
    'GET /api/native/update-readiness': 'Authenticated native update gate — returns the exact service identity plus fail-closed active PTY and provider-session counts, including explicitly in-flight Codex turns.',
    'POST /api/native/shutdown': 'Gracefully stop the exact private dashboard service only after blocking new attachments and revalidating its control capability, identity, active PTYs, and provider sessions.',
    'GET /api/native/launch/status': 'Capability probe used by the native dashboard to find a browser dashboard that supports reciprocal launching.',
    'POST /api/native/launch':       'Focus or start the installed Codex Native app through Windows/WSL2 PowerShell or macOS LaunchServices.',
    'GET /api/status':               'Server health check — returns `ok`, API compatibility version, default provider, provider availability, active PTY count, uptime seconds',
    'GET /api/providers':            'Provider catalog — returns Codex/Devin labels, commands, availability, version, and UI metadata',
    'GET /api/:providerId/terminals': 'List active PTYs for one provider as an array of `{ key, providerId, sessionId, controlPlane, adaptive }`; `adaptive` is a compatibility alias for the control-plane transport flag.',
    'GET /api/terminals':            'Compatibility alias for the default provider active-PTY list.',
    'GET /api/:providerId/stats':    'Provider-scoped dashboard analytics — activity, tools, tokens, MCP servers, skills, plugins. Codex includes 1d/2d/7d/14d/30d/all-time token and credit-estimate rollups by model, project, and session, and supports `statsMode=combined|triage|codex` cohort switching.',
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
    'POST /api/:providerId/sessions/create': 'Start a new session for one provider in the given working directory (body: `{ workingDir: string, controlPlane?: boolean, adaptive?: boolean }`); returns `{ tempKey, controlPlane }`, where `controlPlane` reports the transport actually selected. The status feed later sends `rekey` after ownership-safe persistence or `pending-expired` when an unregistered terminal exits.',
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
    'GET /api/:providerId/sessions/:id/config': 'Per-session provider configuration metadata. Returns `{ rules, activeSkills, permissions, model, reasoningEffort, permissionMode }` where available.',
    'GET /api/sessions/:id/config': 'Compatibility alias for default provider config.',
    'GET /api/:providerId/sessions/:id': 'Single provider session with `ptyActive` flag',
    'GET /api/sessions/:id':         'Single session with `ptyActive` flag',
    'POST /api/:providerId/sessions/:id/rename': 'Update a provider session title (body: `{ title: string }`, maximum 160 characters)',
    'POST /api/sessions/:id/rename': 'Update session title (body: `{ title: string }`, maximum 160 characters)',
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
    UI_MY_CLI_NATIVE_INSTANCE_ID: 'Internal native-service instance identity generated by Codex Native; do not configure manually',
    UI_MY_CLI_NATIVE_CONTROL_CAPABILITY: 'Internal per-service shutdown capability generated and passed by Codex Native; do not configure or persist manually',
    NODE_ENV:                'Set to `production` to enable static file serving from `client/dist/`',
    CODEX_HOME:              'Override the Codex home directory (default: `~/.codex`)',
    CODEX_BIN:               'Override Codex executable discovery; otherwise checks `~/.local/bin`, PATH, Homebrew, and nvm locations',
    PATH:                    'Inherited executable search path; native macOS startup also checks Homebrew and nvm locations explicitly',
    HOME:                    'User home used for Codex, local installs, and nvm discovery',
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
      '**Serial live-service tests.** Playwright intentionally uses one worker locally and in CI because ' +
        'the suite shares one PM2 service and persistent PTY state; parallel workers can race terminal and navigation assertions.',
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

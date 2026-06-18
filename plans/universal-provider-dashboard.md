# Universal Provider Dashboard Plan

Status: planned
Created: 2026-06-17

## Goal

Turn the dashboard into one local app that can switch between fully independent
Codex and Devin modes. The app should keep one shared visual shell, but the
selected provider controls all data, actions, analytics, terminal launch
commands, archive behavior, status derivation, and provider-specific wording.

This should not become a merged session list. Codex and Devin are separate
brains with separate data stores and workflows.

## Current Repo State

Verified on 2026-06-17:

- Current branch is `main`.
- `HEAD` still contains the old Devin implementation.
- The working tree contains the tested Codex-only retrofit.
- New Codex files currently exist in the working tree:
  - `server/codex-paths.js`
  - `server/codex-store.js`
  - `server/dashboard-store.js`
  - `plans/codex-retrofit.md`
- The old Devin code can be recovered from `HEAD`, including:
  - `server/sessions.js`
  - `server/stats.js`
  - `server/subagents.js`
  - `server/db-path.js`
  - `server/pty-manager.js`
  - generated docs/prose and UI copy before the Codex-only pass

## Git Strategy

Do not use a normal stash as the primary safety mechanism. The current Codex
work is large, tested, and valuable; a stash is too easy to lose, overwrite, or
misapply during a multi-phase retrofit.

Recommended sequence:

1. Leave the pre-existing untracked `misc/` directory alone unless explicitly
   told otherwise.
2. Create a checkpoint branch for the current tested Codex retrofit:
   `git switch -c codex-dashboard-checkpoint`
3. Stage all intentional Codex retrofit changes, including generated docs and
   `plans/`, but excluding unrelated `misc/`.
4. Commit the checkpoint:
   `git commit -m "feat: convert dashboard to local Codex sessions"`
5. Create the universal implementation branch from that checkpoint:
   `git switch -c universal-provider-dashboard`
6. During implementation, recover Devin source from the pre-Codex commit
   `77dad00` or from `main` before the Codex checkpoint if branch names change.

Fallback if a commit is not desired:

- Use `git stash push -u -m "codex-dashboard-checkpoint"` only as a temporary
  backup.
- Immediately verify it with `git stash list`.
- Prefer creating a branch and commit before doing any modularization work.

## Product Decision

Build one app with a hard top-level provider switch:

- `Codex`
- `Devin`

When `Codex` is selected:

- Read Codex local state from `~/.codex/state_*.sqlite` and rollout JSONL.
- Resume terminals with `codex resume <id>`.
- Start terminals with `codex`.
- Archive/restore through `codex archive` and `codex unarchive`.
- Use dashboard-local title overrides.
- Show Codex metadata: source, model, reasoning effort, sandbox policy,
  approval mode, memory mode, git branch/SHA, skills/plugins/MCP where
  available.

When `Devin` is selected:

- Use the old Devin SQLite data model.
- Resume terminals with the old `devin --resume <id>` command.
- Start terminals with `devin`.
- Preserve Devin title writes to the Devin SQLite database if that remains the
  desired behavior.
- Preserve Devin-specific analytics, preview metrics, subagent lifecycle,
  cogs/config extraction, context pie, headless detection, and repo workflows.

No cross-provider control:

- Selecting a Devin session should never launch or control Codex.
- Selecting a Codex session should never launch or control Devin.
- Provider switching remounts provider data and active tabs for that provider.

## Architecture

Introduce explicit provider boundaries. Avoid a fake universal data model beyond
the small shape needed by shared UI components.

Target structure:

```text
server/providers/
  index.js
  codex/
    paths.js
    store.js
    stats.js
    pty.js
    metadata.js
  devin/
    paths.js
    store.js
    stats.js
    pty.js
    subagents.js
```

Shared server modules:

```text
server/index.js
server/provider-router.js
server/terminal-hub.js
```

Provider interface:

```js
{
  id: 'codex' | 'devin',
  label: 'Codex' | 'Devin',
  listSessions(),
  listArchivedSessions(),
  getSession(id),
  getSessionPreview(id),
  getSessionConversation(id, offset, limit),
  getSessionContextBreakdown(id),
  getSessionConfig(id),
  renameSession(id, title),
  archiveSession(id),
  restoreSession(id),
  listRepos(),
  listSessionIds(),
  findNewSessionInDir(workingDir, excludeIds),
  searchSessions(query, includeArchived),
  getStats(),
  getLatestPrompt(),
  spawnResumePty(sessionId, workingDir, cols, rows),
  spawnNewPty(tempKey, workingDir, cols, rows),
}
```

Shared normalized session shape:

```js
{
  provider: 'codex' | 'devin',
  id: string,
  title: string,
  workingDir: string,
  project: string,
  model: string,
  status: 'active' | 'question' | 'finished' | 'idle' | 'archived',
  snippet: string | null,
  firstUserPrompt: string | null,
  lastUserPrompt: string | null,
  lastActivityAt: number,
  lastActivityAgo: string,
  createdAt: number,
  source?: string
}
```

Provider-specific preview payloads may include extra fields. The shared
`SessionPreview` component should render common fields and delegate provider
sections to provider-specific components.

## API Plan

Make provider explicit in the API. Keep compatibility aliases only if needed
during migration.

New routes:

```text
GET    /api/providers
GET    /api/:provider/status
GET    /api/:provider/stats
GET    /api/:provider/latest-prompt
GET    /api/:provider/repos
GET    /api/:provider/sessions
GET    /api/:provider/sessions/archived
GET    /api/:provider/sessions/search
POST   /api/:provider/sessions/create
GET    /api/:provider/sessions/:id
GET    /api/:provider/sessions/:id/preview
GET    /api/:provider/sessions/:id/conversation
GET    /api/:provider/sessions/:id/context
GET    /api/:provider/sessions/:id/config
GET    /api/:provider/sessions/:id/subagents
POST   /api/:provider/sessions/:id/rename
POST   /api/:provider/sessions/:id/kill-pty
DELETE /api/:provider/sessions/:id
POST   /api/:provider/sessions/:id/restore
```

WebSocket routes:

```text
WS /ws/:provider/status
WS /ws/:provider/terminal/:id
```

Migration compatibility:

- The existing `/api/sessions` and `/ws/status` routes may remain temporarily
  as aliases to the selected/default provider, but should not be the long-term
  contract.
- Default provider should be `codex` unless `UI_MY_CLI_DEFAULT_PROVIDER=devin`
  is set.

## Client Plan

Add provider state at the app shell level.

State:

- `selectedProvider`: persisted in `localStorage` as
  `ui-my-cli:selected-provider`.
- Provider-scoped tabs:
  - `ui-my-cli:codex:open-tabs`
  - `ui-my-cli:devin:open-tabs`
- Provider-scoped sidebar preferences:
  - `ui-my-cli:codex:*`
  - `ui-my-cli:devin:*`

UI:

- Add a top-level segmented provider switch in the topbar: `Codex | Devin`.
- On provider switch:
  - Close or preserve tabs only for that provider.
  - Reconnect status WebSocket for that provider.
  - Refetch stats/latest prompt/repos/archive drawer for that provider.
  - Clear active terminal/preview from the prior provider.
- Show provider-specific metadata chips in cards and previews.
- Keep shared layout and styles.
- Provider-specific copy should come from provider metadata, not hardcoded
  product names inside shared components.

Component split:

```text
client/src/providers/codex/
  CodexPreviewDetails.jsx
  codexLabels.js

client/src/providers/devin/
  DevinPreviewDetails.jsx
  DevinSubagentTimeline.jsx
  devinLabels.js
```

Shared components:

- `App.jsx`
- `Sidebar.jsx`
- `AgentCard.jsx`
- `Terminal.jsx`
- `ControlBar.jsx`
- `DashboardSplash.jsx`
- `SessionPreview.jsx`
- `TabBar.jsx`

Shared components should accept `provider` and `labels` props instead of
hardcoding `Codex` or `Devin`.

## Implementation Phases

### Phase 0: Checkpoint and Branch

Objective: preserve the tested Codex-only work before modularization.

Steps:

- Commit the current Codex retrofit on a checkpoint branch.
- Keep `misc/` out of the commit unless the user confirms it belongs.
- Create an implementation branch for provider switching.

Acceptance criteria:

- `git status` is clean except intentionally ignored/untracked unrelated files.
- Codex-only checkpoint commit exists and can be restored.

### Phase 1: Extract Current Codex Provider

Objective: move the current Codex implementation behind the provider interface
without changing behavior.

Steps:

- Move current Codex modules into `server/providers/codex/`.
- Keep `server/sessions.js` and `server/stats.js` as temporary facades only if
  useful during migration.
- Extract Codex PTY command construction out of `server/pty-manager.js`.
- Ensure existing Codex-only routes still work through the new provider layer.

Acceptance criteria:

- `npm run build` passes.
- `npm run docs:check` passes.
- Codex sessions, preview, stats, repos, terminal resume, and archive/restore
  still work.
- `PORT=7585 npm run test:smoke` passes against Codex.

Peer review:

- If this phase changes behavior, stop and fix before adding Devin. Provider
  extraction should be behavior-preserving.

### Phase 2: Recover Devin Provider

Objective: restore the old Devin implementation as a provider module.

Steps:

- Recover old source from `HEAD`/`77dad00`:
  - old `server/sessions.js` -> `server/providers/devin/store.js`
  - old `server/stats.js` -> `server/providers/devin/stats.js`
  - old `server/subagents.js` -> `server/providers/devin/subagents.js`
  - old `server/db-path.js` -> `server/providers/devin/paths.js`
  - old Devin PTY command logic -> `server/providers/devin/pty.js`
- Update imports inside recovered modules to use provider-local paths.
- Keep old Devin archive/title semantics unless intentionally changed.
- Restore Devin-specific preview/config/context/subagent behavior.

Acceptance criteria:

- Devin provider can list sessions from the Devin SQLite DB.
- Devin preview, conversation, context, config, stats, and subagent endpoints
  match old behavior.
- Devin terminal resume uses `devin --resume <id>` and new session uses
  `devin`.

Peer review:

- Do not partially translate Devin internals into Codex concepts. Devin keeps
  its old data model.
- If the user no longer has a Devin DB locally, add graceful unavailable-state
  handling instead of failing the whole app.

### Phase 3: Provider-Aware API and WebSockets

Objective: route every server operation through a selected provider.

Steps:

- Add `server/providers/index.js` registry.
- Add provider validation: unsupported provider returns `404`.
- Convert REST routes to `/:provider/...`.
- Convert WebSocket paths to `/ws/:provider/status` and
  `/ws/:provider/terminal/:id`.
- Scope active PTYs by provider and session ID:
  - key format: `${provider}:${sessionId}`
- Scope pending-session rekey maps by provider.
- Watch provider-specific state:
  - Codex: state DB, WAL/SHM, sessions directory.
  - Devin: sessions DB, WAL/SHM.

Acceptance criteria:

- Codex and Devin status feeds can run independently.
- Opening a terminal in one provider cannot attach to a PTY from the other.
- Archive/restore/rename affects only the selected provider.

Peer review:

- This is the highest-risk server phase. Bugs here can cross-wire agent
  sessions. Use provider-prefixed PTY keys everywhere.

### Phase 4: Provider-Aware Client

Objective: add the top-level provider switch and make existing views provider
scoped.

Steps:

- Add provider switch in topbar.
- Update API hooks to include provider in URLs.
- Update WebSocket hook to connect to `/ws/${provider}/status`.
- Update terminal to connect to `/ws/${provider}/terminal/${id}`.
- Scope tabs, filters, archived search, and visible repo preferences by
  provider.
- Split preview details into common and provider-specific sections.
- Replace hardcoded product names with provider labels.

Acceptance criteria:

- Switching providers changes sidebar sessions, stats, preview behavior, and
  terminal behavior.
- Codex tabs persist separately from Devin tabs.
- No Codex controls appear in Devin mode and no Devin controls appear in Codex
  mode except shared UI actions.

Peer review:

- Avoid mixed-provider tabs. If a tab belongs to another provider, it should not
  render under the current provider.

### Phase 5: Provider-Specific Analytics

Objective: make analytics useful for each provider without pretending metrics
are identical.

Codex analytics:

- Session count and recency.
- CLI vs VS Code source breakdown.
- Model/reasoning effort usage.
- Approval/sandbox distribution.
- Tool call/event counts from rollout JSONL.
- Project activity.
- Local feature/config inventory.

Devin analytics:

- Preserve old token charts, tool charts, model usage, context breakdown,
  headless analytics, subagent counts, and project duration.

Shared dashboard:

- Same layout shell, provider-specific cards.
- A small provider header should explain the active data source.

Acceptance criteria:

- No chart crashes when a provider lacks a metric.
- Provider-specific unavailable metrics are hidden, not shown as fake zeroes
  unless zero is truly meaningful.

Peer review:

- Analytics are where a fake abstraction will rot fastest. Prefer explicit
  provider panels over generic but misleading charts.

### Phase 6: Docs, Tests, and Orchestrator

Objective: make the universal app operational and documented.

Docs:

- Update generated README/API/architecture/AGENTS from `scripts/doc-prose.js`.
- Update `docs/user-guide.html`.
- Document provider switch, env vars, PM2, and data sources.

Tests:

- Add provider route smoke tests for Codex.
- Add Devin provider fixture tests if no live Devin DB is available.
- Update Playwright smoke tests to exercise provider switching.
- Keep existing smoke tests provider-aware.

Orchestrator:

- Keep one PM2 app: `codex-dashboard` may be renamed later to
  `agent-dashboard` or `ui-my-cli`.
- Keep the service on port `7575` unless there is a conflict.
- The local service orchestrator can manage it through PM2 once started.

Acceptance criteria:

- `npm run build` passes.
- `npm run docs:check` passes.
- `npm audit --omit=dev` has no production vulnerabilities.
- Playwright smoke tests pass for Codex mode.
- Devin provider tests pass against fixtures or live local Devin DB.
- PM2 app is visible in `http://localhost:3740/`.

## Environment Variables

Shared:

```text
PORT=7575
UI_MY_CLI_DEFAULT_PROVIDER=codex
UI_MY_CLI_DB_PATH=/optional/dashboard-metadata.sqlite
```

Codex:

```text
CODEX_HOME=~/.codex
CODEX_STATE_DB_PATH=/optional/state_5.sqlite
```

Devin:

```text
DEVIN_DB_PATH=/optional/sessions.db
DEVIN_DASHBOARD_DB_PATH=/optional/dashboard.db
```

## Risk Register

Risk: provider cross-wiring terminals.

- Mitigation: provider-prefixed PTY keys and provider-prefixed WebSocket routes.

Risk: accidental direct writes to Codex internals.

- Mitigation: Codex archive/restore goes through CLI; title overrides remain
  dashboard-local.

Risk: Devin recovered code imports shared files that have changed for Codex.

- Mitigation: copy Devin dependencies into `server/providers/devin/` and make
  imports provider-local.

Risk: provider-specific charts crash on missing fields.

- Mitigation: provider-specific analytics components and strict payload shape
  tests.

Risk: stashing loses the tested Codex work.

- Mitigation: branch and commit the Codex checkpoint before implementation.

Risk: docs drift during refactor.

- Mitigation: update `scripts/doc-prose.js` and run `npm run docs` in the same
  phase as API changes.

## Recommendation

Proceed with the universal provider-switched app, but do it from a checkpointed
Codex branch. The old Devin code is still recoverable from `HEAD`, and the new
Codex code is currently in the working tree. This is the best possible moment to
split the app into provider modules before either implementation drifts further.

Do not run two app copies unless the provider-switch refactor proves too costly.
The long-term cost of two ports, two PM2 apps, duplicated UI fixes, and separate
docs is higher than a clean provider boundary now.

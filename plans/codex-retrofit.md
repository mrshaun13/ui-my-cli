# Codex-Only Retrofit Plan

Status: implemented
Last updated: 2026-06-11

## Goal

Convert this dashboard from a Devin CLI session manager into a local Codex
session manager. Devin compatibility is intentionally out of scope. The app
should keep the same general look, tabbed terminal workflow, sidebar search,
session preview, archive/restore behavior, repo picker, and local-first
operational model, but all session data and commands should come from Codex.

Cloud task support is explicitly out of scope. Everything in this plan is local.

## Current Validation

These checks were run before planning implementation:

- `codex --help` confirms local interactive launch supports `codex [PROMPT]`,
  `codex resume [SESSION_ID] [PROMPT]`, `codex archive`, and `codex unarchive`.
- `codex resume --help` confirms sessions can be resumed by UUID or session
  name, and can optionally include all sessions or non-interactive sessions.
- `~/.codex/state_5.sqlite` contains a `threads` table with local thread
  metadata: `id`, `rollout_path`, `created_at`, `updated_at`, `source`,
  `model_provider`, `cwd`, `title`, `sandbox_policy`, `approval_mode`,
  `archived`, `first_user_message`, `model`, `reasoning_effort`, `preview`,
  and other Codex-specific fields.
- Local thread source counts validated that VS Code sessions are visible:
  `cli|user|5`, `vscode|user|4`, and guardian subagent rows are also present.
- Recent thread rows include both `source=cli` and `source=vscode`, with valid
  `rollout_path` values under `~/.codex/sessions/YYYY/MM/DD/*.jsonl`.
- `codex features list` confirms useful local features exist, including
  `apps`, `browser_use`, `computer_use`, `goals`, `hooks`, `memories`,
  `multi_agent`, `plugins`, `shell_snapshot`, and `terminal_resize_reflow`.
- `codex app-server generate-json-schema --help` exists, but app-server and
  remote-control are experimental or not a stable foundation. Do not depend on
  them for the first retrofit.
- 2026-06-11 readiness recheck: `bwrap` is installed at `/usr/bin/bwrap`
  (`bubblewrap 0.9.0`) and a basic bubblewrap command succeeds.
- 2026-06-11 readiness recheck: `codex doctor --summary` reports `17 ok`, `0`
  warnings, and `0` failures. WebSocket and HTTP provider reachability are
  healthy in the current yolo environment.
- 2026-06-11 readiness recheck: project dependencies are installed, `node-pty`
  loads successfully, `pm2` is present, `npm run build` passes, and
  `npm run docs:check` passes.
- 2026-06-11 readiness recheck: Playwright Chromium was installed to
  `~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`. A headless
  Chromium launch through Playwright succeeds.

## Setup Notes

Bubblewrap is installed and working. No further sudo is needed right now based
on the latest `codex doctor --summary` result and a successful headless
Playwright Chromium launch.

Playwright reported the following dry-run command for Chromium system
dependencies. It is not currently needed; run it only if browser tests later
fail with missing shared libraries:

```bash
sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf"
```

## Architecture Decision

Use a Codex adapter as the new backend boundary instead of sprinkling Codex
logic through the existing Devin modules.

Recommended server shape:

- `server/codex-paths.js`: resolve `CODEX_HOME`, active `state_*.sqlite`, and
  dashboard metadata DB path.
- `server/codex-store.js`: read Codex `threads`, parse rollout JSONL, expose
  the session API shape expected by the client.
- `server/codex-pty-manager.js` or refactored `server/pty-manager.js`: spawn
  Codex sessions and resume existing sessions with argv-based process spawning.
- `server/dashboard-store.js`: dashboard-owned metadata such as title
  overrides and any UI-only archive/search state that must not be written into
  Codex internals.

Keep the REST and WebSocket routes mostly stable so the React app changes are
incremental:

- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/preview`
- `GET /api/sessions/:id/conversation`
- `GET /api/repos`
- `POST /api/sessions/create`
- `POST /api/sessions/:id/rename`
- `POST /api/sessions/:id/kill-pty`
- `DELETE /api/sessions/:id`
- `POST /api/sessions/:id/restore`
- `/ws/status`
- `/ws/terminal/:id`

## Phase 0: Durable Planning

Create and maintain this file as the working plan. Update status and decisions
after each implementation phase.

Acceptance criteria:

- This file exists in `plans/`, outside generated docs.
- Every phase below gets checked off or amended as implementation discovers new
  facts.

Peer review:

- `docs/` is generated in this repo, so putting a hand-written plan there would
  create churn or get overwritten. `plans/` is the correct durable location.

## Phase 1: Codex Data Adapter

Implement the Codex session reader.

Behavior:

- Resolve `CODEX_HOME` from env, defaulting to `~/.codex`.
- Resolve the state DB from `CODEX_STATE_DB_PATH` if set; otherwise select the
  newest readable `state_*.sqlite` in `CODEX_HOME`.
- Read `threads` from the state DB in read-only mode.
- Include `source=cli` and `source=vscode` user threads.
- Exclude guardian/subagent review threads from the main user session list by
  default, but preserve the ability to surface them later in a subagent/review
  view.
- Treat `threads.archived=1` as archived for list filtering.
- Build the current client session shape:
  `id`, `title`, `workingDir`, `project`, `model`, `status`, `snippet`,
  `firstUserPrompt`, `lastUserPrompt`, `lastActivityAt`, `lastActivityAgo`,
  `createdAt`, plus `source`, `reasoningEffort`, `sandboxPolicy`, and
  `approvalMode`.
- Parse rollout JSONL from `threads.rollout_path` for conversation turns,
  assistant snippets, tool/function call counts, and richer preview timelines.
- Search should cover title override, Codex title, cwd, first user message,
  preview, and rollout user messages.

Status mapping:

- `active`: PTY is active or `updated_at` is within the last 60 seconds.
- `idle`: no update for more than 10 minutes.
- `question`: latest assistant text ends with `?`.
- `finished`: default non-idle terminal state.

Acceptance criteria:

- `/api/sessions` returns local Codex CLI and VS Code sessions.
- `/api/sessions/:id/preview` works for a CLI session and a VS Code session.
- Search finds sessions by repo path, Codex title, and first user prompt.
- Archived Codex threads do not appear in the active list.

Peer review:

- Risk: Codex local SQLite and JSONL are not a public stable integration API.
  Mitigation: isolate all schema access in `codex-store` and fail soft when
  optional columns are missing.
- Risk: JSONL event shapes vary across Codex versions and surfaces.
  Mitigation: parse by `type` defensively, ignore unknown events, and add
  fixtures from real local CLI and VS Code sessions.
- Risk: using only `session_index.jsonl` would miss metadata that is already
  available in `threads`. Use `threads` as source of truth and JSONL for
  detailed event history.

## Phase 2: PTY and Session Lifecycle

Replace Devin process launch with Codex process launch.

Behavior:

- New session: spawn `codex --cd <workingDir>` or spawn `codex` with `cwd` set
  to the selected repo. Prefer the simpler `cwd` approach unless testing shows
  Codex needs `--cd` to set the thread root correctly.
- Resume session: spawn `codex resume <sessionId>` with `cwd` set to the
  thread's `cwd`.
- Use `node-pty` argv arrays rather than shell command interpolation.
- Keep scrollback replay, resize behavior, xterm response filtering, and PTY
  kill behavior.
- Re-key pending sessions after Codex writes the new thread to `threads`; detect
  new thread by comparing pre-launch IDs and matching `cwd`.
- Keep `DEVIN_DASHBOARD` env cleanup replaced with an app-specific variable
  such as `UI_MY_CLI_DASHBOARD=1`.

Acceptance criteria:

- Clicking an existing Codex session opens `codex resume <id>` in the embedded
  terminal.
- Creating a new session starts Codex in the selected repo and re-keys the
  pending tab when the Codex thread is written.
- PTY resize and reconnect scrollback still work.

Peer review:

- Risk: spawning through a shell can reintroduce injection bugs.
  Mitigation: use argv-based spawning and validate UUID-like session IDs before
  resume.
- Risk: Codex may write a new thread later than Devin did.
  Mitigation: keep the pending-session re-key loop but tune timeout based on
  observed Codex behavior.
- Risk: VS Code-created sessions may have cwd values not present or not
  accessible from this dashboard process.
  Mitigation: fall back to `os.homedir()` for missing paths and show the
  original cwd in the UI.

## Phase 3: Archive, Rename, and Dashboard Metadata

Use Codex CLI for Codex-owned archive state and dashboard SQLite for UI-only
metadata.

Behavior:

- Archive: call `codex archive <id>`, kill any active PTY, then refresh
  sessions.
- Restore: call `codex unarchive <id>`, then refresh sessions.
- Rename: store dashboard-local title overrides keyed by session ID because
  local `codex --help` exposes no rename command.
- Dashboard metadata DB should live under `CODEX_HOME`, defaulting to
  `~/.codex/ui-my-cli-dashboard.db`, overrideable with
  `UI_MY_CLI_DB_PATH`.

Acceptance criteria:

- Archive and restore are reflected in Codex's thread state.
- Rename affects the dashboard UI without mutating Codex internal SQLite rows.
- Dashboard title overrides survive server restart.

Peer review:

- Risk: directly updating `threads.title` would work today but is brittle.
  Mitigation: do not write Codex internal SQLite except through supported CLI
  commands.
- Risk: CLI archive commands may fail if Codex changes output or auth state.
  Mitigation: treat command exit code as source of truth and return clear API
  errors.

## Phase 4: UI Refresh for Codex

Retain the current visual language while replacing Devin labels and adding
Codex-specific metadata.

Behavior:

- Rename visible product text to Codex-oriented wording.
- Show source chips for `CLI`, `VS Code`, and later any other local sources.
- Show model, reasoning effort, sandbox policy, approval mode, memory mode, and
  git branch/SHA when available.
- Replace Devin-only analytics with Codex-native panels:
  session volume, repo activity, top tools/function calls, model usage,
  reasoning effort distribution, approval mode distribution, source breakdown,
  and recent prompts.
- Update SessionPreview into a richer event timeline with user messages,
  assistant messages, tool calls, approval requests, errors, and phase/status
  events where available.
- Migrate localStorage keys from `devin-dash:*` to `codex-dash:*` once on
  startup.

Acceptance criteria:

- Existing layout remains recognizable.
- No user-facing copy says Devin.
- VS Code sessions are visibly distinguishable from CLI sessions.
- Devin-only concepts such as Cogs, agent mode, and Devin subagent labels are
  removed or replaced.

Peer review:

- Risk: showing unavailable Devin metrics would be misleading.
  Mitigation: redesign the panels around actual Codex data instead of filling
  gaps with nulls.
- Risk: too much metadata could make the UI noisy.
  Mitigation: keep high-signal chips in the card/header and move details into
  preview panels.

## Phase 5: Local Codex Enhancements

Add Codex-specific value beyond parity, without cloud dependencies.

Recommended enhancements:

- Environment health panel:
  show Codex version, selected `CODEX_HOME`, state DB path, feature flags from
  `codex features list`, config profile indicators, auth presence, and common
  warnings.
- Feature flag/config inspector:
  surface stable local features such as `apps`, `browser_use`, `computer_use`,
  `goals`, `hooks`, `memories`, `multi_agent`, `plugins`, and
  `shell_snapshot`.
- Review/subagent lane:
  guardian and subagent rows already exist in `threads`; expose them as linked
  review/subagent events instead of mixing them into the main session list.
- Shell snapshot viewer:
  link sessions to available `~/.codex/shell_snapshots` when the rollout events
  or session metadata indicate relevant snapshots.
- Local app-server spike:
  generate schemas with `codex app-server generate-json-schema --out /tmp/...`
  and evaluate whether the local protocol can provide stable structured
  events. Do not depend on it in v1.

Acceptance criteria:

- Enhancements are additive and do not block core Codex session management.
- No cloud commands or cloud task data are used.
- Experimental surfaces are hidden behind a clearly labeled local-only spike or
  disabled by default.

Peer review:

- Risk: chasing experimental app-server/remote-control could stall the retrofit.
  Mitigation: ship on local SQLite/JSONL/CLI first, then evaluate app-server as
  a contained spike.
- Risk: `codex features list` includes removed or under-development features.
  Mitigation: display stage and effective state exactly, and avoid enabling
  anything automatically.

## Phase 6: Docs and Tests

Update docs from generated sources and add focused tests.

Behavior:

- Update `scripts/doc-prose.js` and doc generation code to describe Codex,
  local state, VS Code source support, and new env vars.
- Run `npm run docs` after source/doc-prose changes.
- Update Playwright helper text from Devin to Codex.
- Add fixture-backed server tests for Codex adapter behavior. If the project
  does not already have unit test infrastructure, add a lightweight Node test
  script rather than forcing all coverage through Playwright.

Acceptance criteria:

- `npm run build` passes.
- `npm run docs:check` passes.
- Smoke tests pass against a local PM2 server with at least one Codex session.
- Fixture tests cover CLI sessions, VS Code sessions, archived sessions, and
  malformed/unknown JSONL events.

Peer review:

- Risk: Playwright tests require a live local server and local session state,
  which makes edge cases hard to test.
  Mitigation: use fixture tests for adapter logic and Playwright only for
  end-to-end UI confidence.

## Implementation Order

1. Keep this plan updated. Done.
2. Build `codex-paths` and `codex-store` with fixtures. Done with live local
   Codex state validation; fixture tests are still a future hardening step.
3. Wire existing REST APIs to Codex store. Done.
4. Replace PTY commands and pending re-key logic. Done.
5. Replace archive/restore/rename behavior. Done.
6. Refresh UI labels and Codex metadata. Done.
7. Rebuild analytics around Codex data. Done with existing dashboard contract
   preserved.
8. Add local Codex enhancements. Partially done: source, model, reasoning,
   sandbox, approval, skills, plugins, MCP, and version metadata are surfaced
   through API data; richer dedicated inspector views remain future work.
9. Regenerate docs and run verification. Done.

## Implementation Validation

Completed on 2026-06-11:

- Direct backend adapter validation passed against local Codex state:
  sessions, preview, conversation, context, repos, latest prompt, and stats all
  return valid data.
- Production server validation on `PORT=7585` passed for `/api/status`,
  `/api/sessions`, `/api/stats`, `/api/repos`, preview, conversation, context,
  config, and subagents endpoints.
- Headless browser smoke validation passed: session cards render, preview
  opens, terminal mounts, and no page errors were reported.
- `PORT=7585 npm run test:smoke` passed: 8/8 Playwright smoke tests.
- `npm run build` passed.
- `npm run docs:check` passed.
- Temporary validation PTYs and validation server were stopped after testing.

## Non-Goals

- No Devin compatibility.
- No Codex Cloud integration.
- No direct writes to Codex internal SQLite tables for Codex-owned state.
- No reliance on experimental app-server or remote-control for v1.
- No broad visual redesign unless a component is tightly coupled to Devin-only
  concepts.

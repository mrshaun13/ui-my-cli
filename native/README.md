# Codex Native for Windows

Codex Native is a browser-free Windows frontend for the Codex CLI installed in
WSL2. The interactive path is:

```text
Avalonia terminal control -> Windows ConPTY -> terminal bridge -> WebSocket -> persistent WSL2 PTY -> Codex CLI
Avalonia terminal control -> Windows ConPTY -> WSL2 -> Ubuntu login shell
```

No React, browser, or xterm.js is involved. Project files, Codex state, and the
PTY remain in WSL2. A small console bridge connects the native ConPTY view to
the same persistent, buffered server PTY used by the web dashboard. Closing the
native UI disconnects the view without killing Codex; reopening it reattaches
and replays recent scrollback.

## Features

- Conversation-aware search across active and optionally archived sessions.
- Multi-project filter chips plus waiting-for-input, headless, and age filters.
- Multiple simultaneous session tabs backed by persistent WSL2 PTYs.
- Unlimited horizontally scrollable terminal panes, each with its own tab strip
  and independently resizable context/configuration panel. Session and new-run
  pickers can target any pane, and the complete pane workspace is restored.
- Detachable tabs, explicit Stop actions, and terminal reattachment after the
  native application exits.
- Automatic terminal-bridge reconnect with bounded backoff and a manual
  "Retry now" action when the WSL2 view disconnects unexpectedly.
- New-session chooser with Codex and Ubuntu-shell modes plus searchable known
  WSL projects and paths. Ubuntu tabs open a direct login shell in the selected
  project and close the shell when the tab or application closes.
- Automatic reconciliation of new terminals with their saved Codex session ID.
- Per-terminal Adaptive model routing. When enabled, a native prompt composer
  uses local task-shape rules first, calls a small ephemeral classifier only
  for low-confidence requests, validates the decision against Codex's live
  `model/list` catalog, and submits the turn with a supported model and
  reasoning effort. Non-Adaptive terminals retain the existing direct PTY path.
- Clipboard-aware screenshot paste: copy a Windows snip, press `Ctrl+V` in a
  Codex terminal, and the native client stores a managed temporary PNG and
  inserts its WSL-accessible image reference into the composer. Storage defaults
  to the current Windows user's `%LOCALAPPDATA%\CodexNative\captures` directory,
  and paths are translated through the configured WSL distribution. The capture
  directory, retention period (three days by default), and maximum image size
  are configurable; ordinary text paste is unchanged.
  Each Codex viewport also has a camera button that opens Windows screen
  clipping and attaches the completed capture without requiring `Ctrl+V`.
- Per-session context usage, model, reasoning, permissions, rules, active
  skills, latest prompt, rename, and archive controls.
- Native session summaries with complete conversation history, copy actions,
  an interactive context-composition ring, tool usage, model changes, and real
  Codex subagent lifecycle timelines with task/result details.
- Actionable summaries with rename, confirmed archive, restore, resume,
  incremental history loading, loaded-history search, detailed rules/skills,
  and expanded token/context telemetry.
- Headless-run summaries plus archived-session browsing and restore.
- Push-driven session updates over the dashboard status feed, with polling as a
  health fallback.
- Animated, hoverable and keyboard-explorable workspace analytics for hourly
  token activity, weekday/hour heatmaps, toggleable project trends, all six
  token categories, tools, environment, and three session leaderboards.
- Clickable latest-prompt navigation and analytics cohort switching across
  combined, transcript-triage-only, and native-Codex-only data.
- Codex provider health, persistent PTY count, CLI version, rate-limit windows,
  reset times, plan, and credit status.
- Persistent tabs, active session, sidebar width/collapse state, project,
  search, multi-project, waiting, headless, archive, analytics-window, and
  age-filter preferences.
- A compact collapsed session rail that preserves status visibility and quick
  switching without consuming the full sidebar width, with rich native
  tooltips for project, activity time, status, and latest prompt.
- Responsive dashboard, terminal-inspector, and session-preview layouts that
  reflow cards and actions as the native window narrows.
- Nineteen native dashboard styles, including black-terminal neon red, blue,
  green, and purple variants, plus four text/terminal size options. All use
  theme-owned input, dropdown, button, checkbox, scrollbar,
  focus, hover, drag, and selected-state chrome instead of Fluent's default
  white outlines. Scrollbars use one stable full-size geometry so their visual
  state and drag position cannot diverge.
- A theme selector on every terminal pane. Each pane follows the dashboard
  theme by default or can persist an independent style without recoloring the
  surrounding dashboard or neighboring terminal panes.
- A custom transparent pixel-art C identity used by the Windows executable,
  title bar, and in-app header.
- Reuses an existing ui-my-cli metadata service on port 7575 so the browser and
  native clients do not duplicate Codex-state scans. If 7575 is unavailable,
  it starts a private fallback service inside WSL2 on port 7577.
- Remembers the WSL distribution, working directory, style, and text size in
  `%LOCALAPPDATA%\CodexNative\settings.json`.
- Desktop shortcuts: `Ctrl+K` search, `Ctrl+Shift+N` new Codex or Ubuntu
  session, `Ctrl+R` refresh, `Ctrl+W` detach a Codex tab or close an Ubuntu
  tab, and `Esc` return home.

### Screenshot storage settings

Screenshot storage is per Windows user and contains no fixed user or WSL home
path. These optional properties in `%LOCALAPPDATA%\CodexNative\settings.json`
control the managed capture cache:

```json
{
  "ScreenshotCaptureDirectory": "%LOCALAPPDATA%\\CodexNative\\captures",
  "ScreenshotRetentionDays": 3,
  "ScreenshotMaximumMegapixels": 32
}
```

`ScreenshotCaptureDirectory` accepts an absolute Windows path with environment
variables. Invalid or relative values fall back to the per-user default.
Positive retention values are constrained to 1–90 days and positive image-size
values to 1–100 megapixels; missing or non-positive values use the defaults.

### Adaptive routing

Adaptive is stored per terminal pane and is off by default. Enabling it
reconnects that pane's Codex terminals through a private loopback app-server
while keeping the authentic Codex TUI visible. Prompts submitted through the
native Adaptive composer are classified as simple, standard, deep, or critical
and routed only to model/effort combinations advertised for the signed-in user.
The composer shows the selected model, effort, route level, and whether the
model classifier was needed. Turning Adaptive off reconnects the normal direct
Codex terminal and restores manual `/model` control.

The classifier never receives the full transcript and is skipped for
high-confidence local decisions. Routing failure preserves the draft and does
not silently submit with a different configuration.

## Build

Install the .NET 10 SDK, then run from the repository root:

```bash
npm run native:test
npm run native:build
npm run native:publish
```

The self-contained Windows build is written to `native/artifacts/win-x64/`.
Copy that directory to Windows and run `CodexNative.exe`; keep
`CodexNative.WslHost.exe` beside it. The target machine
must have WSL2, the configured Ubuntu distribution, and Codex installed inside
that distribution.

The app defaults to the `Ubuntu` distribution, a WSL home inferred from the
Windows account name (`/home/<user>`), and the ui-my-cli checkout beneath it.

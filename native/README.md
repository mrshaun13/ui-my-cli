# Codex Native for Windows and macOS

Codex Native is a browser-free Avalonia frontend for the local Codex CLI. It
keeps the dashboard service as the authoritative owner of persistent PTYs, so
the browser and desktop clients can reconnect to the same live sessions.

The native frontend is currently a development preview, not a standalone
desktop distribution. Its package contains the Avalonia UI and terminal/update
helpers; it does not contain the Node.js dashboard service, npm dependencies,
or Codex state. A prepared local ui-my-cli checkout remains required.

## Current macOS status

The macOS client is intentionally shipping in this merged baseline with known
unresolved bugs. A real Apple Silicon test confirmed that a locally built app
can launch, but the tested build did not load the user's real Codex sessions
and reported the Codex provider as unavailable. Backend/session discovery,
terminal behavior, and the native updater still require diagnosis and complete
real-Mac validation. These fixes belong in a version-bumped follow-up PR based
on the merged baseline.

Downloaded packages are also unsigned and unnotarized, so Gatekeeper can report
the app as damaged. Until a follow-up release closes these gaps, macOS support
must be treated as experimental and not fully functional.

```text
Windows: Avalonia PTY -> terminal host -> WebSocket -> persistent WSL2 PTY -> Codex
macOS:   Avalonia PTY -> terminal host -> WebSocket -> persistent local PTY -> Codex
shell:   Avalonia PTY -> validated project path -> platform login shell
```

Closing the native UI detaches its terminal views without killing server-owned
Codex processes. Direct local-shell tabs are intentionally UI-owned and end
when their tab or the app closes.

## Features

- Conversation-aware search across active and optionally archived sessions.
- Multi-project filter chips plus waiting-for-input, headless, and age filters.
- Multiple simultaneous session tabs backed by persistent platform PTYs.
- Unlimited horizontally scrollable terminal panes, each with its own tab strip
  and independently resizable context/configuration panel. Session and new-run
  pickers can target any pane, and the complete pane workspace is restored.
- Detachable tabs, explicit Stop actions, and terminal reattachment after the
  native application exits.
- Automatic terminal-bridge reconnect with bounded backoff and a manual
  "Retry now" action when a terminal view disconnects unexpectedly.
- New-session chooser with Codex and platform-shell modes plus searchable known
  projects and paths. Shell tabs open a direct login shell in the selected
  project and close the shell when the tab or application closes.
- Automatic reconciliation of new terminals with their saved Codex session ID.
- Per-terminal Adaptive model routing. When enabled, a native prompt composer
  uses local task-shape rules first, calls a small ephemeral classifier only
  for low-confidence requests, validates the decision against Codex's live
  `model/list` catalog, and submits the turn with a supported model and
  reasoning effort. Non-Adaptive terminals retain the existing direct PTY path.
- Clipboard-aware screenshot paste: copy a Windows or macOS image, press
  `Ctrl+V` in a Codex terminal, and the native client stores a managed temporary
  PNG and inserts its host-accessible image reference into the composer. Windows
  paths are translated through the configured WSL distribution; macOS paths stay
  native. The capture
  directory, retention period (three days by default), and maximum image size
  are configurable; ordinary text paste is unchanged.
  Each Codex viewport also has a camera button that opens Windows screen
  clipping or macOS interactive capture and attaches the completed image
  without requiring `Ctrl+V`.
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
- Reuses a compatible ui-my-cli metadata service on port 7575 so the browser
  and native clients do not duplicate Codex-state scans. If 7575 is unavailable,
  it starts a private platform service on the first open port from 7577–7596.
- Remembers the distribution where applicable, working directory, style, text
  size, and pane workspace in the platform-local `CodexNative/settings.json`.
- Desktop shortcuts: `Ctrl` on Windows or `Cmd` on macOS plus `K` for search,
  `Shift+N` for a new Codex or platform-shell session, `R` for refresh, and `W`
  to detach a Codex tab or close a shell; `Esc` returns home.

### Screenshot storage settings

Screenshot storage is per OS user and contains no fixed user or WSL home path.
These optional properties in the platform-local `CodexNative/settings.json`
control the managed capture cache:

```json
{
  "ScreenshotCaptureDirectory": "%LOCALAPPDATA%\\CodexNative\\captures",
  "ScreenshotRetentionDays": 3,
  "ScreenshotMaximumMegapixels": 32
}
```

`ScreenshotCaptureDirectory` accepts an absolute host path with environment
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

Additional release/runtime capabilities preserved from v1.1.2:

- Push-driven Codex sessions with hot/cold grouping, a compact count-labelled
  project filter, archive search, attention filters, and buffered terminal
  reattachment.
- Multiple simultaneous terminal tabs with reconnect status and manual retry.
- New-session chooser for persistent Codex sessions and a platform login shell.
- Rich session previews for crash-safe deferred conversation search, context
  composition, model changes, configuration, delegated subagents, and prominent
  fresh-input/cached-input/output/reasoning/total-token/credit summaries.
- Cohort analytics with 24-hour through all-time token and estimated-credit
  rollups by model, project, and session; quota/provider status; latest-prompt
  navigation; ten themes; four text sizes; responsive layouts; keyboard
  shortcuts; and saved workspace state. Credit estimates show coverage and do
  not assign guessed rates to unpublished model aliases. Reasoning tokens are
  included in output-token cost rather than multiplied by reasoning effort.
  Estimates assume Standard mode because stored telemetry does not identify
  Fast mode reliably enough to apply its separate multiplier.
- Reuses a compatible service on `127.0.0.1:7575`; if none exists, discovers or
  starts a private service on the first available loopback port from 7577
  through 7596 without exposing it to the network. Incompatible leftovers are
  skipped instead of trapping startup in a port-conflict loop.
- Checks stable GitHub Releases for a newer platform package. Updates are
  bounded, SHA-256 verified, staged outside the installation, and installed
  only after two consecutive checks find no active Codex sessions
  or running local-shell tabs. An external helper replaces the app, restores
  the prior payload if handoff fails, and restarts the new version.

## Prerequisites

All platforms need Codex CLI, Node.js 18 or newer, an installed ui-my-cli
checkout with dependencies, and the .NET 10 SDK only when building locally.

Windows additionally needs WSL2 and the configured Ubuntu distribution. The
desktop process delegates the service and shell launch to WSL, while persistent
Codex PTYs remain server-owned there.

macOS needs Command Line Tools (`xcode-select --install`) so `node-pty` can be
installed in the checkout. Apple Silicon and Intel packages are separate. The
app looks for Node through `NODE_BIN`, `PATH`, Homebrew's standard paths, and
installed nvm versions. It finds a checkout above the app artifact or under
common home-directory locations. If the checkout is elsewhere, set
`UI_MY_CLI_HOME` before first launch or set
`DashboardWorkingDirectory` in the app settings file under the platform's local
application-data `CodexNative` directory.

Finder does not inherit a login-shell PATH. The private service therefore looks
for Codex through `CODEX_BIN`, `~/.local/bin`, the inherited PATH, Homebrew's
standard paths, and installed nvm versions.

Prepare that checkout before launching the native app:

```bash
npm install
npm run build
codex --version
ls ~/.codex/state_*.sqlite
```

Run Codex once if the state database does not exist. When the app starts its
private service, backend stdout and stderr are written to
`~/Library/Application Support/CodexNative/codex-native.log`. The Codex service
card also displays the provider error instead of reducing it to
`Unavailable · version unknown`.

The native client requires dashboard API v2 for analytics. It will not attach
to an older long-running service that lacks the complete usage-rollup, pricing,
hourly, and heatmap window contract; it starts the current private service on
port 7577 instead. This prevents absent fields from being presented as real
zero-token or zero-credit results.

## Build and package

Install the .NET 10 SDK, then run from the repository root:

```bash
npm run native:test
npm run native:build
npm run native:publish:win
npm run native:publish:mac
npm run native:package
```

Artifacts are written to:

- `native/artifacts/win-x64/`
- `native/artifacts/osx-x64/CodexNative.app`
- `native/artifacts/osx-arm64/CodexNative.app`
- `native/artifacts/releases/CodexNative-v<version>-<runtime>.zip` and
  `.zip.sha256`

The macOS packages are real `.app` bundles with a native Mach-O app host and
terminal host. Cross-publishing verifies their structure from Linux, but final
release packages still require macOS launch testing, code signing, and Apple
notarization before distribution outside a development machine.

## Run

### Windows portable installation

The Windows release is intentionally a portable application rather than an
installer. Download the versioned `win-x64` ZIP and its `.sha256` manifest from
the repository's GitHub Releases page. Verify that the ZIP's SHA-256 matches the
manifest before extracting or unblocking any executable.

From PowerShell in the download directory, compare the calculated hash with the
first value in the manifest. Stop if they differ:

```powershell
$zip = "CodexNative-v<version>-win-x64.zip"
$expected = (Get-Content "$zip.sha256").Split()[0].ToLowerInvariant()
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Codex Native ZIP checksum mismatch" }
```

Extract the complete archive to a stable, local, user-writable directory:

```text
%LOCALAPPDATA%\Programs\CodexNative
```

Do not run the application from inside the ZIP, the Downloads directory, the
Desktop, OneDrive, or another synchronized/network directory. The updater
atomically renames and replaces the installation directory; sync clients can
deny that operation or leave stale folder entries. Keep all three executables
together:

```text
CodexNative.exe
CodexNative.TerminalHost.exe
CodexNative.Updater.exe
```

The binaries are not currently code-signed. After verifying the GitHub origin
and SHA-256, right-click each executable, select **Properties**, check
**Unblock**, and select **Apply**. If Windows or an organization policy does not
offer or permit Unblock, do not bypass that policy; use an approved build or ask
the administrator responsible for the device.

Run `CodexNative.exe` from that stable directory and pin that executable to the
taskbar if desired. Updates replace the same directory in place, preserve the
shortcut target, retain the previous payload long enough to roll back a failed
handoff, and automatically restart the new version.

On macOS, copy the matching `CodexNative.app` to `Applications` or run it from
the artifact directory. An unsigned local development build may require an
explicit Open action in Finder. A downloaded unsigned build can be rejected as
damaged because Gatekeeper applies quarantine to the archive. Do not remove
quarantine from downloaded release builds as a substitute for signing and
notarization; use a locally built development app until signed artifacts exist.

Desktop shortcuts are `Ctrl+K` search, `Ctrl+Shift+N` new Codex or local-shell
session, `Ctrl+R` refresh, `Ctrl+W` detach/close the selected tab, and `Esc`
return home. On macOS, Avalonia currently retains these control-key mappings so
the behavior matches the Windows client.

## Release and update contract

`Directory.Build.props` is the native version source. Every CI artifact and
updater archive includes that version and runtime, such as
`CodexNative-v1.1.3-osx-arm64.zip`. Pull requests retain these versioned Actions
artifacts for short-term validation; they are not production releases.

The pinned GitHub Actions workflow tests native command policy, builds Windows
x64 and macOS Intel/Apple Silicon on matching runners, and validates executable
formats and bundle metadata. A stable release can then be published in either
of two controlled ways:

1. Push an exact `v<version>` tag matching `Directory.Build.props`.
2. Run the **Native desktop** workflow on `main` with **publish_release=true**;
   the workflow creates the matching tag and release.

Both paths publish the three versioned ZIPs and SHA-256 manifests in the
repository's GitHub Releases section. Existing releases are immutable: the
workflow refuses to replace a version that already exists. GitHub Packages is
not used because these desktop archives are not npm, NuGet, Maven, or container
packages; GitHub Releases is the supported generic-binary distribution surface.

The Release publisher also includes versionless compatibility aliases for the
pre-1.1.1 updater, which cannot discover versioned asset names. Those aliases
are updater migration inputs; people downloading manually should choose the
versioned archive. New clients require the versioned asset/checksum pair.

The updater never runs `git pull`, changes the user's checkout, or requires a
developer toolchain. It updates only the desktop release. The independently
managed dashboard service and its persistent PTYs remain running during the
desktop swap. macOS signing and notarization are still required before treating
a tagged package as a broadly distributable trusted application.

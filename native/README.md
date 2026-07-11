# Codex Native for Windows and macOS

Codex Native is a browser-free Avalonia frontend for local headless-agent
providers (Codex and Devin). It keeps the dashboard service as the authoritative
owner of persistent PTYs, so the browser and desktop clients can reconnect to
the same live sessions. An Agent selector loads `/api/providers` and scopes the
dashboard list, search, analytics, archives, and terminal bridges to the
selected provider—matching the browser's hard provider switch.

The native frontend is currently a development preview, not a standalone
desktop distribution. Its package contains the Avalonia UI and terminal,
speech, and update helpers; it does not contain the Node.js dashboard service,
npm dependencies, or provider state. A prepared local ui-my-cli checkout
remains required.

## macOS v1.1.4 runtime recovery

The macOS client now recovers from a stale configured checkout by selecting a
ready local checkout instead of starting a service from an old worktree. A
checkout is ready only when it has the dashboard sources and the installed
`express` and `node-pty` dependencies. If none is ready, the native status and
session rail explicitly say that dashboard setup is required and name the
missing checkout or dependency step instead of presenting an empty dashboard.

The local Node dashboard service also repairs the executable mode that npm can
lose on node-pty's Unix `spawn-helper` (including darwin-arm64). This prevents
the otherwise opaque `posix_spawnp failed` error and restores Codex terminal
attachments on macOS and other non-Windows hosts.

The v1.1.4 packaged app was validated on Apple Silicon against real local Codex
state: it found sessions, started its private loopback service, and attached a
real Codex terminal. The updater handoff and macOS signing/notarization remain
separate release concerns.

Downloaded packages are also unsigned and unnotarized, so Gatekeeper can report
the app as damaged. Until a follow-up release closes these gaps, macOS support
must be treated as experimental and not fully functional.

```text
Agent:   Avalonia Agent selector -> GET /api/providers -> /api/:providerId/* + /ws/:providerId/*
Windows: Avalonia PTY -> terminal host -> provider-scoped WebSocket -> persistent WSL2 PTY -> selected provider CLI
macOS:   Avalonia PTY -> terminal host -> provider-scoped WebSocket -> persistent local PTY -> selected provider CLI
shell:   Avalonia PTY -> validated project path -> platform login shell
```

Closing the native UI detaches its terminal views without killing server-owned
provider PTYs. On macOS, the private local service is launched through
`nohup` so it can survive Finder/LaunchServices closing the UI and the next
native or browser UI can reconnect. Closing the macOS window hides it and keeps
the app visible in the menu bar; use that icon to reopen the dashboard, start
or reconnect the service, stop a service started by this app, or quit. Stopping
is refused while a terminal is active so an explicit service action cannot
silently interrupt agent work. Direct local-shell tabs are intentionally
UI-owned and end when their tab or the app closes.

## Features

- Agent provider switcher (Codex / Devin) backed by `/api/providers`, with
  provider-scoped REST, WebSocket status feeds, terminals, search, archives,
  and session actions. The selected provider persists in settings; open tabs
  retain their provider identity across switches and reloads.
- Conversation-aware search across active and optionally archived sessions for
  the selected provider.
- Multi-project filter chips plus waiting-for-input, headless, and age filters.
- Multiple simultaneous session tabs backed by persistent platform PTYs.
- Selection-first terminal mouse behavior: plain drag highlights text even when
  the agent TUI has mouse reporting enabled, `Ctrl+C` on Windows/Linux or
  `Cmd+C` on macOS copies the selection without interrupting the session,
  macOS `Ctrl+C` remains SIGINT, and `Alt`+drag remains available for raw TUI
  mouse input.
- Multiline and long session titles are compacted only in constrained native
  views; renaming and workspace persistence retain the complete title.
- Unlimited horizontally scrollable terminal panes, each with its own tab strip
  and independently resizable context/configuration panel. Session and new-run
  pickers can target any pane, and the complete pane workspace is restored.
- Detachable tabs, explicit Stop actions, and terminal reattachment after the
  native application exits.
- Automatic terminal-bridge reconnect with bounded backoff and a manual
  "Retry now" action when a terminal view disconnects unexpectedly.
- New-session chooser with selected-provider agent and platform-shell modes plus
  projects and paths. Shell tabs open a direct login shell in the selected
  project and close the shell when the tab or application closes. Codex tabs
  pass that selected project as an explicit working root even when their TUI is
  connected through the shared app-server control plane.
- Automatic reconciliation of new terminals with their saved Codex session ID.
  A healthy blank terminal remains open until its first prompt creates the
  persisted thread; only a terminal that actually exits is dismissed.
- Per-terminal Adaptive model routing for Codex. When enabled, a native prompt composer
  uses local task-shape rules first, calls a small ephemeral classifier only
  for low-confidence requests, validates the decision against Codex's live
  `model/list` catalog, and submits the turn with a supported model and reasoning
  effort. Compatible native Codex terminals keep one persistent app-server-backed
  PTY whether Adaptive routing is on or off. Existing direct or fallback PTYs stay
  running and show Adaptive as unavailable instead of being restarted or migrated.
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
- Local voice-to-text in any native terminal through the microphone button
  beside the camera button.
  Capture runs only between explicit start and stop clicks in an isolated
  helper process, is normalized to 16 kHz mono, trimmed with Silero VAD, and
  transcribed locally with Whisper base.en. The text is inserted without being
  submitted: into the terminal input in direct mode, or into the initiating
  pane's prompt box when Adaptive is enabled.
- Live per-session context usage, model, reasoning, permissions, rules, active
  skills, latest prompt, rename, and archive controls. Persisted `turn_context`
  changes from either `/model` or Adaptive routing refresh the open inspector.
- Native session summaries with complete conversation history, copy actions,
  an interactive context-composition ring, tool usage, model changes, and real
  Codex subagent lifecycle timelines with task/result details.
- Actionable summaries with rename, confirmed archive, restore, resume,
  incremental history loading, loaded-history search, detailed rules/skills,
  and expanded token/context telemetry.
- Headless-run summaries plus archived-session browsing and restore.
- Push-driven session updates over the selected provider's status feed, with
  polling as a health fallback.
- Animated, hoverable and keyboard-explorable workspace analytics for hourly
  token activity, weekday/hour heatmaps, toggleable project trends, all six
  token categories, tools, environment, and three session leaderboards. Non-Codex
  providers surface token activity without Codex credit rollups or pricing
  telemetry.
- Clickable latest-prompt navigation and Codex analytics cohort switching across
  combined, transcript-triage-only, and native-Codex-only data.
- Selected-provider service health, persistent PTY count, CLI version, and
  (when available) rate-limit windows, reset times, plan, and credit status.
- Persistent selected provider, tabs (with per-tab provider), active session,
  sidebar width/collapse state, project, search, multi-project, waiting,
  headless, archive, analytics-window, and age-filter preferences.
- A compact collapsed session rail that preserves status visibility and quick
  switching without consuming the full sidebar width, with rich native
  tooltips for project, activity time, status, and latest prompt.
- Responsive dashboard, terminal-inspector, and session-preview layouts that
  reflow cards and actions as the native window narrows, including a compact
  header (Agent/Style/Text labels collapse under ~1100px) and viewport-fitted
  terminal pane widths.
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
  and native clients do not duplicate provider-state scans. If 7575 is unavailable,
  it starts a private platform service on the first open port from 7577–7596.
- Remembers the selected provider, distribution where applicable, working
  directory, style, text size, and pane workspace in the platform-local
  `CodexNative/settings.json`.
- Desktop shortcuts: `Ctrl` on Windows or `Cmd` on macOS plus `K` for search,
  `Shift+N` for a new agent or platform-shell session, `R` for refresh, and `W`
  to detach a provider tab or close a shell; `Esc` returns home.

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

Adaptive is stored per terminal pane and is off by default. Native Codex
terminals request a private loopback app-server control plane while keeping the
authentic Codex TUI visible, regardless of the Adaptive preference. A terminal
that was already started through the browser or an older release, or that fell
back after control-plane startup failed, remains on its direct transport. The
native app does not restart or migrate that PTY; it shows Adaptive as unavailable
and hides the composer while the terminal keeps running. On compatible terminals,
switching Adaptive on or off changes only where new prompts are composed and
routed and does not restart the PTY. Prompts submitted through the
native Adaptive composer are classified as simple, standard, deep, or critical
and routed only to model/effort combinations advertised for the signed-in user.
The composer shows the selected model, effort, route level, and whether the
model classifier was needed. Turning Adaptive off keeps the same terminal and
returns prompt entry to the authentic Codex TUI, including its `/model` command.

The classifier never receives the full transcript and is skipped for
high-confidence local decisions. Routing failure preserves the draft and does
not silently submit with a different configuration.

### Local voice-to-text

The speech helper starts on demand and the microphone is released after stop,
cancel, tab close, macOS window hide, or application shutdown. Each recording is
limited to two minutes; reaching the limit stops capture and starts local
transcription automatically. Audio is not sent to a remote service. The first
use downloads the Whisper base.en and Silero VAD model files to the OS user's
`CodexNative/speech-models` application-data directory; both models are accepted
only after their pinned SHA-256 values verify. Later uses reuse the local models.

The implementation records capture-start latency, peak level, clipping,
leading/trailing silence, and word error rate for a supplied reference phrase.
Its speech-host protocol can also transcribe absolute `.wav` fixtures, including
Handy recordings, so the same phrases and microphone can be compared before a
release is considered Handy-equivalent. Automated tests cover lifecycle,
metric, WAV round-trip/resampling, and parity thresholds; a physical microphone
bake-off remains a release gate because CI cannot measure the user's audio
hardware, room, or OS permissions.

Windows asks for microphone access through the normal privacy controls. macOS
uses `NSMicrophoneUsageDescription` in the app bundle and carries the
audio-input entitlement for future signed builds. A denied permission or
missing input device is reported in the dashboard status line.

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
Codex PTYs remain server-owned there. Optional local voice-to-text on Windows
requires Windows 11 or Windows Server 2022, an AVX2/FMA-capable processor, and
the Microsoft Visual C++ Redistributable for Visual Studio 2022. The portable
release does not bundle or provision alternate speech runtimes or that
redistributable.

macOS needs Command Line Tools (`xcode-select --install`) so `node-pty` can be
installed in the checkout. Apple Silicon and Intel packages are separate. The
app looks for Node through `NODE_BIN`, `PATH`, Homebrew's standard paths, and
installed nvm versions. It finds a ready checkout above the app artifact, in
common home-directory locations, or one level below Desktop/Documents/Developer,
Projects, or Code. It prefers a checkout with installed Node dependencies over
a stale configured path. If the checkout is elsewhere, set `UI_MY_CLI_HOME`
before first launch or set `DashboardWorkingDirectory` in the app settings file
under the platform's local application-data `CodexNative` directory.

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

The native client requires dashboard API v5 so remote Codex sessions preserve
the project root selected in the native chooser. It will not attach to an older
long-running service that lacks that launch contract or the complete
usage-rollup, pricing, hourly, and heatmap analytics contract; it starts the
current private service on port 7577 instead. This prevents sessions from
starting in the wrong directory and absent analytics fields from being
presented as real zero-token or zero-credit results.

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

The macOS packages are real `.app` bundles with native Mach-O app, terminal,
speech, and updater hosts plus the local Whisper runtime. Cross-publishing
verifies their structure from Linux, but final
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
deny that operation or leave stale folder entries. Keep all four executables
together:

```text
CodexNative.exe
CodexNative.TerminalHost.exe
CodexNative.SpeechHost.exe
CodexNative.Updater.exe
runtimes\win-x64\*.dll
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
`CodexNative-v1.1.6-osx-arm64.zip`. Pull requests retain these versioned Actions
artifacts for short-term validation; they are not production releases.

The pinned GitHub Actions workflow tests native command policy, builds Windows
x64 and macOS Intel/Apple Silicon on matching runners, validates executable
formats and bundle metadata, and runs per-RID release archive verification with
`npm run native:verify-artifacts -- <rid>` after packaging each matrix runtime.
Locally, omit the RID argument to verify all three packaged runtimes under
`native/artifacts/releases`. A stable release can then be published in either
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

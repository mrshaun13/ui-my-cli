# Changelog

## Unreleased

### Native desktop 1.1.7

- Bumped the native version to 1.1.7 for the terminal-selection, session-title,
  updater, and pending-session reliability release stacked on 1.1.6.
- Made plain terminal drag select text even when an agent TUI enables mouse
  reporting, while preserving `Alt`+drag for raw TUI mouse input.
- Added platform-native selection copying: `Ctrl+C` copies on Windows and
  Linux, `Cmd+C` copies on macOS, and macOS `Ctrl+C` still sends SIGINT.
- Enforced a 160-character durable session-title limit for new renames, while
  retaining compact legacy-title rendering only in constrained views; browser
  rename editors now show validation/server errors and apply only canonical
  titles returned after a successful save.
- Fixed the confirmed Windows updater handoff failure that left v1.1.3 in
  place after repeated v1.1.4 downloads. The helper now waits for UI-owned
  terminal hosts, retries transient install-directory locks, verifies the
  installed version, checks the relaunched process through startup, preserves
  rollback, protects the backup until startup validation completes, and
  automatically relaunches the previous install after failure.
- Added one-time update-result reporting and updater-owned failure dialogs so
  a rolled-back handoff remains visible even when the restored app predates
  result reporting.
- Added cached and coalesced GitHub release checks with ETag revalidation,
  friendly 403/429 reset times, and optional authentication only through the
  explicitly supplied `CODEX_NATIVE_GITHUB_TOKEN` environment variable.
- Fixed new-session prompt loss in both browser and native clients. A pending
  session can remain unregistered while its PTY is attached, with exact Codex
  origin correlation and a bounded fallback preventing unrelated same-folder
  sessions from being claimed.
- Added cross-platform copy/select-all shortcuts and a visible **Copy all**
  action for terminal scrollback.
- Bounded new-session titles and prompt previews at API and native layout
  boundaries, excluding injected AGENTS/environment/goal envelopes from
  user-prompt metadata.
- Kept the same updater, release discovery, terminal lifecycle, and clipboard
  behavior in the Windows x64, macOS Intel, and macOS Apple Silicon builds.
- Made sequential multi-runtime publishing deterministic by restoring each
  native project for its requested RID before compiling the release payload.
- Remaining non-goals: cloud speech, auto-submit of transcribed text, macOS
  signing/notarization, and a fully self-contained desktop payload remain
  separate work.

### Native desktop 1.1.6

- Added local native voice-to-text: per-terminal microphone control, dedicated
  cross-platform speech helper (Silero VAD + Whisper base.en), and insert into
  terminal input or Adaptive composer without auto-submit.
- Stabilized terminal bridges across viewport/splitter resize so live PTYs are
  not torn down during window animations; Adaptive mode no longer force-
  reconnects every open terminal when toggled.
- Preserved pending Codex sessions and selected project roots through first
  prompt / control-plane create paths; refreshed live model and context
  metadata for open native inspectors.
- Packaged SpeechHost into native release archives and documented keeping the
  speech helper with the other desktop executables.
- Limited microphone capture to two minutes with automatic transcription,
  canceled active capture when macOS hides the window, and documented the
  optional Windows voice runtime requirements.
- Bumped the native version to 1.1.6 for the voice/session-stability release
  stacked on 1.1.5 provider switcher.
- Remaining non-goals: cloud speech, auto-submit of transcribed text, and
  macOS signing/notarization remain out of scope.

### Native desktop 1.1.5

- Added a native Agent selector backed by `/api/providers` so Codex and Devin
  can coexist in the Avalonia desktop app without mixing session lists.
- Scoped native dashboard REST, WebSocket, tabs, previews, archives, and
  session actions by selected provider; persists `ProviderId` in native
  settings and stamps each pane tab so reattach stays provider-correct.
- Hardened provider switches: status-feed restart/rollback, refresh and search
  epoch guards, multi-provider update drain and service-stop, pending-tab
  rekey after full refresh, catalog refresh when switching, and safer preview
  provider fallbacks.
- Devin analytics omit Codex-only credit rollups and pricing telemetry when
  Devin is selected.
- Fixed native pane theming and responsive header/pane sizing for the
  provider-aware chrome.
- Bumped the native version to 1.1.5 and documented mandatory version +
  `CHANGELOG.md` release hygiene for agent contributors.
- Remaining non-goals: macOS signing/notarization and a fully self-contained
  desktop payload remain separate work.

### Native desktop 1.1.4

- Recovered the native macOS runtime against a real Apple Silicon environment:
  the app now prefers a ready local ui-my-cli checkout (dashboard sources plus
  installed `express` and `node-pty`) over a stale configured path, and reports
  missing checkout or dependency setup as an actionable native status instead
  of an empty dashboard.
- Expanded checkout discovery to common home-directory locations and one level
  under Desktop, Documents, Developer, Projects, and Code.
- Repaired the executable bit npm can lose on node-pty's Unix `spawn-helper` at
  dashboard startup and before each PTY spawn, eliminating the opaque
  `posix_spawnp failed` terminal failure on macOS and other non-Windows hosts.
- Launched the private macOS dashboard service through `nohup` so it survives
  Finder/LaunchServices UI closure and supports terminal reattachment.
- Added a macOS menu-bar service lifecycle: closing the window hides it while
  the menu-bar icon can reopen the dashboard, start or reconnect the service,
  stop an app-managed idle service (refused while a terminal is active), or
  quit after a best-effort stop.
- Bumped the native version to 1.1.4; each native release matrix job verifies its
  RID archive with `npm run native:verify-artifacts -- <rid>`.
- Remaining non-goals: the package still requires a prepared local ui-my-cli
  checkout with Node and dependencies; macOS signing, notarization, and a fully
  self-contained desktop payload remain separate work.

### Native desktop 1.1.3

- Added a persistent, horizontally resizable multi-pane native workspace with
  per-pane tabs, context inspectors, themes, Adaptive routing preferences, and
  complete workspace restoration.
- Preserved the v1.1.2 drain-aware updater, private-service recovery, versioned
  Windows/macOS release assets, checksum verification, rollback, and automatic
  restart behavior while reconciling the feature branch with current `main`.
- Made direct shell tabs, shortcuts, terminal links, screenshot paste/capture,
  and browser-to-native launching platform-aware on both Windows and macOS.
- Corrected browser-to-Windows launch discovery to use the supported portable
  install root at `%LOCALAPPDATA%\Programs\CodexNative` and added macOS native
  activation through LaunchServices.
- Added tests for pane sizing, safe terminal links, screenshot attachment paths,
  Adaptive model routing/app-server startup, and Windows/macOS native launch.
- Strengthened native CI so server integration tests, the production client
  build, and deterministic root/client dependency installs gate every native
  pull request and stable release.
- Updated the pinned Vite development toolchain to 6.4.3 and refreshed Babel
  transitive locks to clear the current Windows path and source-map advisories.

### Documentation

- Documented the supported portable Windows installation under
  `%LOCALAPPDATA%\Programs\CodexNative`, including SHA-256 verification,
  keeping all three executables together, pinning the stable executable path,
  and avoiding Desktop, Downloads, OneDrive, and network-synchronized folders
  that can block atomic updates.
- Documented the Windows Properties **Unblock** step for the currently unsigned
  executables only after release-origin and checksum verification, without
  advising users to bypass organization policy.
### Native desktop 1.1.2 hotfix

- Fixed native self-update failures when the loopback dashboard service stopped
  after the package download but before the active-session drain check. The
  update handoff now performs one bounded service rediscovery/restart and then
  repeats the drain query; explicit cancellation still stops immediately and
  package trust, checksum, extraction, and active-session gates are unchanged.
- The already-published 1.0.0/1.1.1 application cannot receive this running-code
  change until it completes one upgrade. If its service has stopped, use the
  dashboard refresh action to restart the service before retrying the update,
  or install the versioned Windows ZIP directly from GitHub Releases.

### Native desktop 1.1.1 development preview

This preview is being merged as the shared development baseline so that the
Windows/macOS frontend, updater, packaging, and diagnostics are available for
follow-up work. It is not a declaration that the macOS application is fully
functional or ready for end-user distribution.

- The native Windows and macOS frontend is not yet a standalone desktop
  distribution. It requires a prepared local ui-my-cli checkout, Node.js and
  npm dependencies, the Codex CLI, and an existing local Codex state database.
- The macOS client has known unresolved runtime problems. A real Apple Silicon
  test confirmed that a locally built app launches, but it did not load the
  tester's real Codex sessions and reported the Codex provider as unavailable.
  Session discovery, backend integration, terminal behavior, and the native
  update path still need diagnosis and end-to-end validation in a follow-up PR.
- Downloaded macOS packages are not yet signed or notarized and can be rejected
  by Gatekeeper as damaged. Local development builds can be tested, but trusted
  distribution requires Apple Developer signing and notarization.
- The .NET 10 SDK policy now accepts newer installed feature bands while keeping
  10.0.109 as the minimum selected SDK, avoiding conflicts with current
  Homebrew SDK installations.
- Finder-launched builds now resolve Codex from Homebrew and nvm locations even
  when those directories are absent from Finder's inherited PATH.
- The next macOS follow-up must branch from the merged baseline, fix the
  evidence-backed runtime failures, bump the native version, update this
  changelog, and provide real-Mac validation before claiming macOS support.
- Fixed a native analytics regression where the desktop client reused a stale
  unversioned service on port 7575, interpreted missing rollup fields as zero,
  and left credit/model/session summaries empty. Dashboard API v2 now requires
  the complete analytics contract and starts the current private service when
  an older shared service is present.
- Fixed the 48-hour heatmap bucket, which previously wrote two-day activity into
  the one-day bucket and left the selected two-day heatmap empty. All six window
  selectors now have exact hourly, heatmap, rollup, model, project, and session
  data contracts.
- Token activity input and output now use one common vertical scale instead of
  separate maxima that visually exaggerated the smaller series. Legitimately
  empty windows show an explicit no-telemetry message instead of an unexplained
  blank panel.
- Fixed native startup when an incompatible or orphaned private data service
  already occupies port 7577. The client now discovers compatible services and
  retries validated private ports 7577 through 7596 instead of repeatedly
  launching into the same collision and exiting with code 1.
- Native CI artifacts and updater archives now include the exact native version
  and runtime, for example `CodexNative-v1.1.1-win-x64.zip`. Matching tags or an
  explicit main-branch workflow dispatch publish immutable ZIP/checksum pairs
  to GitHub Releases for normal repository downloads. Releases retain
  versionless compatibility aliases so the pre-1.1.1 updater can migrate to the
  versioned contract.

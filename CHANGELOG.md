# Changelog

## Unreleased

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

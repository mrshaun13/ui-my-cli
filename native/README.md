# Codex Native for Windows and macOS

Codex Native is a browser-free Avalonia frontend for the local Codex CLI. It
keeps the dashboard service as the authoritative owner of persistent PTYs, so
the browser and desktop clients can reconnect to the same live sessions.

The native frontend is currently a development preview, not a standalone
desktop distribution. Its package contains the Avalonia UI and terminal/update
helpers; it does not contain the Node.js dashboard service, npm dependencies,
or Codex state. A prepared local ui-my-cli checkout remains required.

```text
Windows: Avalonia PTY -> terminal host -> WebSocket -> persistent WSL2 PTY -> Codex
macOS:   Avalonia PTY -> terminal host -> WebSocket -> persistent local PTY -> Codex
shell:   Avalonia PTY -> validated project path -> platform login shell
```

Closing the native UI detaches its terminal views without killing server-owned
Codex processes. Direct local-shell tabs are intentionally UI-owned and end
when their tab or the app closes.

## Features

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
- Reuses a compatible service on `127.0.0.1:7575`; if none exists, starts a
  private service on `127.0.0.1:7577` without exposing it to the network.
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
- `native/artifacts/releases/CodexNative-<runtime>.zip` and `.zip.sha256`

The macOS packages are real `.app` bundles with a native Mach-O app host and
terminal host. Cross-publishing verifies their structure from Linux, but final
release packages still require macOS launch testing, code signing, and Apple
notarization before distribution outside a development machine.

## Run

On Windows, keep `CodexNative.TerminalHost.exe` beside `CodexNative.exe` and run
`CodexNative.exe`.

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

`Directory.Build.props` is the native version source. A stable release tag must
be exactly `v<version>`. The pinned GitHub Actions workflow tests native command
policy, builds Windows x64 and macOS Intel/Apple Silicon on matching runners,
validates executable formats and bundle metadata, and publishes one ZIP plus
one SHA-256 manifest per runtime.

The updater never runs `git pull`, changes the user's checkout, or requires a
developer toolchain. It updates only the desktop release. The independently
managed dashboard service and its persistent PTYs remain running during the
desktop swap. macOS signing and notarization are still required before treating
a tagged package as a broadly distributable trusted application.

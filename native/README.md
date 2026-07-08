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

`Directory.Build.props` is the native version source. Every CI artifact and
updater archive includes that version and runtime, such as
`CodexNative-v1.1.1-osx-arm64.zip`. Pull requests retain these versioned Actions
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

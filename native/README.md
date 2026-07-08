# Codex Native for Windows and macOS

Codex Native is a browser-free Avalonia frontend for the local Codex CLI. It
keeps the dashboard service as the authoritative owner of persistent PTYs, so
the browser and desktop clients can reconnect to the same live sessions.

```text
Windows: Avalonia PTY -> terminal host -> WebSocket -> persistent WSL2 PTY -> Codex
macOS:   Avalonia PTY -> terminal host -> WebSocket -> persistent local PTY -> Codex
shell:   Avalonia PTY -> validated project path -> platform login shell
```

Closing the native UI detaches its terminal views without killing server-owned
Codex processes. Direct local-shell tabs are intentionally UI-owned and end
when their tab or the app closes.

## Features

- Push-driven Codex sessions with hot/cold grouping, project filters, archive
  search, attention filters, and buffered terminal reattachment.
- Multiple simultaneous terminal tabs with reconnect status and manual retry.
- New-session chooser for persistent Codex sessions and a platform login shell.
- Rich session previews for conversation, context composition, model changes,
  configuration, and delegated subagents.
- Cohort analytics, quota/provider status, latest-prompt navigation, ten themes,
  four text sizes, responsive layouts, keyboard shortcuts, and saved workspace
  state.
- Reuses a compatible service on `127.0.0.1:7575`; if none exists, starts a
  private service on `127.0.0.1:7577` without exposing it to the network.

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

## Build and package

Install the .NET 10 SDK, then run from the repository root:

```bash
npm run native:test
npm run native:build
npm run native:publish:win
npm run native:publish:mac
```

Artifacts are written to:

- `native/artifacts/win-x64/`
- `native/artifacts/osx-x64/CodexNative.app`
- `native/artifacts/osx-arm64/CodexNative.app`

The macOS packages are real `.app` bundles with a native Mach-O app host and
terminal host. Cross-publishing verifies their structure from Linux, but final
release packages still require macOS launch testing, code signing, and Apple
notarization before distribution outside a development machine.

## Run

On Windows, keep `CodexNative.TerminalHost.exe` beside `CodexNative.exe` and run
`CodexNative.exe`.

On macOS, copy the matching `CodexNative.app` to `Applications` or run it from
the artifact directory. An unsigned local development build may require an
explicit Open action in Finder. Do not remove quarantine from downloaded
release builds as a substitute for signing and notarization.

Desktop shortcuts are `Ctrl+K` search, `Ctrl+Shift+N` new Codex or local-shell
session, `Ctrl+R` refresh, `Ctrl+W` detach/close the selected tab, and `Esc`
return home. On macOS, Avalonia currently retains these control-key mappings so
the behavior matches the Windows client.

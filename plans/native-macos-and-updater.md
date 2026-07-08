# Native macOS and Safe Update Implementation Plan

## Goal

Deliver the existing Avalonia native dashboard on macOS without weakening the
browser/service architecture, then add an in-app updater that installs trusted
repository releases only after active Codex work has drained and restarts the
native client automatically.

## Architectural decisions

1. Keep the Node dashboard service and its `node-pty` sessions independent from
   the desktop process. The desktop app remains a client; closing or updating it
   must not terminate server-owned Codex sessions.
2. Replace the Windows-named terminal helper with a cross-platform terminal
   host. On Windows it can still launch WSL and normalize ConPTY input. On macOS
   it bridges the Avalonia PTY to the loopback WebSocket service and launches a
   local login shell directly.
3. Treat operating-system behavior as an explicit platform adapter: executable
   names, shell labels, service startup, paths, and packaging must not be spread
   across UI event handlers.
4. Define "repository update" as a newer published GitHub Release, not an
   arbitrary branch head. Updating from source would require Git, Node, npm, and
   the .NET SDK on the target machine and could destroy local checkout changes.
5. Download a platform/architecture-specific release archive and matching
   SHA-256 manifest over HTTPS, verify the digest before extraction, reject zip
   traversal and symlink entries, stage the complete payload, then hand off to a
   separate updater process that waits for the UI process to exit, swaps the
   installation, and restarts it.
6. The update button may check and download while sessions are running, but it
   may not begin installation while any non-headless Codex session reports the
   canonical `active` status. It should display the wait state and proceed
   automatically once the status feed/API confirms the drain.
7. Release packaging must emit Windows x64 plus macOS x64 and arm64 artifacts.
   macOS output is a real `.app` bundle; signing/notarization remains an explicit
   release-environment concern and must not be falsely claimed by local builds.

## Milestone 1: cross-platform native runtime

- Add a testable platform model and executable/path resolver.
- Rename/generalize `CodexNative.WslHost` to `CodexNative.TerminalHost`.
- Preserve Windows WSL behavior and add macOS local-service/local-shell behavior.
- Make UI labels, settings defaults, helper lookup, and footer status platform
  aware.
- Add `osx-x64` and `osx-arm64` publish/package scripts and a macOS `.app`
  bundle layout.
- Validate core command tests, Windows publish regression, both macOS publishes,
  bundle structure, docs generation, and diff hygiene from Linux.
- Commit this milestone independently.

## Milestone 2: release-aware updater

- Introduce semantic version/release models and a GitHub release client with a
  fixed repository allowlist, bounded responses, timeouts, and HTTPS-only asset
  URLs.
- Implement digest verification, safe archive extraction, staging, and an
  external update installer/restart helper with rollback on failed replacement.
- Add update UI state: checking, available, downloading, waiting for sessions,
  installing, current, and failed.
- Gate installation on zero canonical `active` interactive sessions and recheck
  immediately before handoff.
- Add deterministic tests using fake HTTP/process/filesystem fixtures where
  practical; never make unit tests depend on a live GitHub release.
- Commit this milestone independently.

## Milestone 3: release automation and completion audit

- Add GitHub Actions jobs that test on Linux, publish Windows and both macOS
  architectures, package artifacts, produce SHA-256 manifests, and attach them
  to version-tagged releases.
- Keep the application version in one source of truth consumed by .NET,
  package metadata, release asset naming, and update comparison.
- Update generated documentation through `scripts/doc-prose.js` and the docs
  generator; do not hand-edit generated docs.
- Run all Linux-available tests/builds/publishes and inspect PE, Mach-O, archive,
  and `.app` metadata. Record macOS-native launch, Gatekeeper, terminal input,
  update replacement, and restart as the remaining hardware validation matrix.
- Commit and push each validated milestone to the existing PR branch.

## Security and recovery checks

- No shell interpolation of repository, version, asset, or path values.
- No hardcoded credentials; GitHub public release checks are unauthenticated.
- HTTPS only, loopback only for local dashboard/terminal endpoints, SHA-256
  integrity checks, bounded downloads, safe archive paths, and no executable
  launch from a partially extracted payload.
- Never install a downgrade or a release for another OS/architecture.
- Never mutate the user's Git checkout during update.
- Preserve the previous installed payload until the new payload is complete;
  restore it if replacement or restart preparation fails.

## Acceptance evidence

- Core tests cover Windows WSL and macOS command construction, platform labels,
  release/version ordering, active-session drain decisions, URL/asset allowlists,
  checksum mismatch, and malicious archive entries.
- `dotnet build` succeeds for the UI and terminal host.
- Self-contained `win-x64`, `osx-x64`, and `osx-arm64` publishes succeed.
- macOS artifacts contain a structurally valid `CodexNative.app` with both native
  executables and matching architecture; Windows artifacts remain runnable PE
  executables.
- Update UI cannot hand off installation while an interactive session is
  `active`, automatically continues after drain, and records actionable errors.
- Native macOS execution and end-to-end updater replacement are explicitly not
  declared validated until run on macOS hardware or a macOS CI runner.

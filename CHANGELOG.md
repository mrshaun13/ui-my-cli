# Changelog

## Unreleased

### Native desktop 1.1.0 development preview

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

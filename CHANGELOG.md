# Changelog

## Unreleased

### Native desktop development preview

- The native Windows and macOS frontend is not yet a standalone desktop
  distribution. It requires a prepared local ui-my-cli checkout, Node.js and
  npm dependencies, the Codex CLI, and an existing local Codex state database.
- macOS session discovery and end-to-end terminal behavior still require
  validation on real Apple Silicon and Intel machines. Provider and backend
  startup errors are now exposed in the UI and local diagnostic log so this
  validation can produce actionable failures.
- Downloaded macOS packages are not yet signed or notarized and can be rejected
  by Gatekeeper as damaged. Local development builds can be tested, but trusted
  distribution requires Apple Developer signing and notarization.
- The .NET 10 SDK policy now accepts newer installed feature bands while keeping
  10.0.109 as the minimum selected SDK, avoiding conflicts with current
  Homebrew SDK installations.
- Finder-launched builds now resolve Codex from Homebrew and nvm locations even
  when those directories are absent from Finder's inherited PATH.

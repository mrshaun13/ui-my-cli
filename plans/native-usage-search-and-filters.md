# Native usage, search, and filter pass

## Scope

Update the shared Avalonia native frontend and Codex analytics service so the
Windows and macOS builds receive the same fixes and usage reporting.

## Architecture decisions

1. **Search rendering is deferred and cancellable.** The conversation search
   must not clear and rebuild the visual tree from inside Avalonia's
   `TextChanged` dispatch. Filtering remains a pure operation and the UI applies
   the latest result after a short debounce.
2. **One project-filter source of truth.** Remove the unbounded project pill
   wall. The existing project selector becomes a full-width, count-labelled
   control that actually drives the session filter. Existing persisted
   multi-project selections migrate to the first matching project.
3. **Usage aggregation belongs in the data service.** The server returns the
   same windowed totals and model/project/session breakdowns to every client.
   Native views render that contract; they do not independently recalculate it.
4. **Credits are estimates with explicit coverage.** Published Codex rates are
   applied only to exact, documented model families. Unknown/private aliases
   remain unpriced and reduce the displayed pricing coverage instead of being
   silently mapped to a guessed rate.
5. **Reasoning is output, not a second multiplier.** Reasoning-output tokens are
   shown separately for visibility but are already included in output tokens
   and use the documented output-token credit rate.

## Milestones

- [x] Add pure conversation filtering and deferred native rendering; cover the
      two-character regression.
- [x] Replace project pills with the functional compact filter layout.
- [x] Add documented Codex credit-rate calculation and tests.
- [x] Add 1d, 2d, 7d, 14d, 30d, and all-time rollups by model, project, and
      session.
- [x] Add prominent per-session usage/credit cards and window-aware dashboard
      rollups.
- [x] Bump the native minor version and regenerate documentation.
- [x] Build/test/package Windows x64, macOS Intel, and macOS ARM; push to PR #21
      and wait for CI.

## Peer review of the plan

- **Correctness risk:** token events are incremental while session totals are
  cumulative. Window rollups must sum `last_token_usage`; all-time session cards
  must retain the cumulative total and account for any unmatched remainder as
  unpriced rather than double-counting.
- **Pricing drift risk:** the rate card is date-stamped and linked to the
  official source. Unknown models must never inherit a nearby model's pricing.
- **UX risk:** compact layouts can hide meaning. The selected window, pricing
  coverage, and the fact that reasoning is included in output need visible
  labels, not tooltips alone.
- **Cross-platform risk:** no OS-specific view implementation is introduced.
  CI must compile and package the same shared code for all three release RIDs.
- **Security risk:** search text remains data only; no shell or SQL construction
  is introduced. Usage data stays local and no pricing lookup is performed at
  runtime.

## Acceptance checks

- Typing `scope` and other multi-character text cannot synchronously rebuild
  the tree and only the latest query is rendered.
- Project selection changes the visible session list; no project-pill wall is
  present.
- A session summary visibly shows fresh input, cached input, total output,
  reasoning output, total tokens, estimated credits, and pricing coverage.
- Dashboard selection of 24h or 7d updates totals and model/project/session
  lists, not only the hourly chart.
- Unknown models show unpriced tokens/partial coverage rather than fabricated
  credits.
- Native version, generated docs, unit tests, native tests, builds, release
  packages, and PR CI all pass.

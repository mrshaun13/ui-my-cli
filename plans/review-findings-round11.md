# Review Findings Round 11 Plan

1. Preserve browser collision terminals with separate stable tab identity, canonical session metadata ID, and terminal transport ID. Keep the temporary transport and mounted WebSocket unchanged until explicit close or process exit, while routing preview/archive metadata through the canonical ID. Add reducer-level tests for collision and normal re-key behavior.
2. Bound pending-to-real mappings with a compatibility expiry for successful re-keys and retain collision mappings exactly while the pending PTY remains alive. Drive cleanup from PTY lifecycle callbacks rather than perpetual map scans, and cover adaptive-submit mappings.
3. Add a versioned, authenticated update-readiness contract with a fail-closed count of active sessions across every provider. Set the no-new-attach gate before the final readiness check, clear it on refusal, and revalidate inside the shutdown handler so session creation cannot race replacement.
4. Add a target-specific install lock in the stable parent directory. Have the updater acquire it before the final process scan and retain it through install, rollback, and restart verification. Arbitrary native startup must exit while the lock is held; only the updater-launched replacement may wait for release. Add lock-contention and startup-policy tests.
5. Route latest-prompt preview and tooltip text through the shared bounded, control-safe display transform.
6. Regenerate documentation if the API/native contract changes, then run focused JS and native command tests, docs checks, builds, and proportional security review.

/**
 * Headless session helpers — pure presentation rules, no server changes.
 *
 * Headless sessions are detected by the prefix `headless-MMDDYYYY-` appearing
 * in EITHER the session title OR the project (working-dir basename). Different
 * launch scripts put it in different places: the user-facing example was a
 * title (`headless-04272026-ai_progression_use_cases_presentation`), but
 * existing runs in this DB also use a directory-name convention
 * (`headless-04272026-generato--...`). Matching both is more robust and
 * costs nothing.
 *
 * The DB's `title` column is the single source of truth shared with
 * `devin list` and `/ls` inside a session. We never mutate it; we just
 * derive a clean display title and a boolean flag at render time.
 */

// MMDDYYYY = exactly 8 digits — strict on purpose so a user-named
// "headless-mode-test" session is never falsely classified.
const HEADLESS_RE = /^headless-\d{8}-(.+)$/

// Static glyph for headless sessions — replaces the live status icon
// because interaction with a headless run is fundamentally different
// (no PTY to attach to, no question-prompt cycle).  Kept here next to
// isHeadless/displayTitle so the "what does headless look like" rules
// live in one module.
export const HEADLESS_ICON = '⧉'

export function isHeadless(session) {
  if (!session) return false
  return HEADLESS_RE.test(session.title || '') ||
         HEADLESS_RE.test(session.project || '')
}

/**
 * Returns a clean display title for the session.
 *   - If the title carries the headless prefix → strip it and unsnake.
 *   - If the title doesn't match but the project does (legacy launches put
 *     the prefix in the working-dir name) → use the stripped project as
 *     the display label, so the card doesn't show a giant auto-generated
 *     prompt as its title.
 *   - Otherwise → fall back to the raw title.
 */
export function displayTitle(session) {
  if (!session?.title) return ''
  const m = session.title.match(HEADLESS_RE)
  if (m) return m[1].replace(/_/g, ' ')
  const pm = (session.project || '').match(HEADLESS_RE)
  if (pm) return pm[1].replace(/_/g, ' ')
  return session.title
}

/**
 * Returns the project name with any `headless-MMDDYYYY-` prefix stripped,
 * for the project label under the title.  Falls back to the raw project.
 */
export function displayProject(session) {
  if (!session?.project) return ''
  const m = session.project.match(HEADLESS_RE)
  if (!m) return session.project
  return m[1]
}


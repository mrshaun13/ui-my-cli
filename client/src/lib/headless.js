/**
 * Headless-session helpers — pure presentation rules, no server changes.
 *
 * "Headless" in this app means any auto-generated batch agent run, as
 * opposed to a human-launched interactive session in a real repo.  Two
 * patterns identify them:
 *
 *   1. Explicit headless prefix: `headless-MMDDYYYY-<rest>`
 *      e.g. headless-04272026-ai_progression_use_cases_presentation
 *
 *   2. Trailing timestamp suffix: `…-<10+ digits>` at the very end.
 *      Auto-launchers (the CLI's bg-run wrapper, transcript-pipeline
 *      triage jobs, etc.) all stamp their sandbox dir name with a
 *      Date.now()-style trailing ID, e.g.
 *        tp-triage-2026-04-26-monster-promot-for-opus4-7-1777246127507
 *        2026-04-25-ai-guild-meeting-1777109430757
 *      Real interactive repos (`speakeasy`, `ui-my-cli`, …) never
 *      have this shape, so this is a reliable signal.
 *
 * The DB's `title` column is the single source of truth shared with
 * `devin list` and `/ls` inside a session.  We never mutate it; we
 * just derive a clean display title and a boolean flag at render time.
 *
 * Detection runs against EITHER the title OR the project (working-dir
 * basename) — different launch scripts put the noise in different
 * places.
 *
 * IMPORTANT: keep these regexes in lockstep with `_isHeadlessSession`
 * in server/stats.js so the splash analytics agree with the sidebar.
 */

// MMDDYYYY = exactly 8 digits.  Strict on purpose so a user-named
// "headless-mode-test" session is never falsely classified.
const HEADLESS_PREFIX_RE = /^headless-\d{8}-(.+)$/

// Auto-generated trailing timestamp — typically Date.now() (13 digits)
// but allow 10+ to cover seconds-precision IDs too.
const TRAILING_ID_RE = /^(.+?)-(\d{10,})$/

// Optional leading ISO date `YYYY-MM-DD-` — common in transcript / triage
// dirs.  We strip it from the display name so users see e.g.
// `ai-guild-meeting` instead of `2026-04-25-ai-guild-meeting`.
const LEADING_DATE_RE = /^\d{4}-\d{2}-\d{2}-(.+)$/

export function isHeadless(session) {
  if (!session) return false
  const title   = session.title   || ''
  const project = session.project || ''
  return HEADLESS_PREFIX_RE.test(title)   ||
         HEADLESS_PREFIX_RE.test(project) ||
         TRAILING_ID_RE.test(title)       ||
         TRAILING_ID_RE.test(project)
}

/**
 * Strip the auto-generation noise from a candidate name:
 *   1. Leading `headless-MMDDYYYY-` if present.
 *   2. Trailing `-<10+ digits>` (timestamp ID) if present.
 *   3. Leading `YYYY-MM-DD-` if present after step 1.
 *   4. Underscores → spaces for readability.
 *
 * Returns null if `name` is falsy or strips down to empty.
 */
function _strip(name) {
  if (!name) return null
  let s = name
  // 1. Strip leading headless-MMDDYYYY-
  const hm = s.match(HEADLESS_PREFIX_RE)
  if (hm) s = hm[1]
  // 2. Strip trailing -<digits>
  const tm = s.match(TRAILING_ID_RE)
  if (tm) s = tm[1]
  // 3. Strip leading YYYY-MM-DD-
  const dm = s.match(LEADING_DATE_RE)
  if (dm) s = dm[1]
  // 4. Underscores → spaces
  s = s.replace(/_/g, ' ').trim()
  return s.length > 0 ? s : null
}

/**
 * Returns a clean display title for the session.
 *   - Tries to strip noise from `session.title` first.
 *   - Falls back to a stripped project name if the title is unhelpful
 *     (e.g. an auto-generated long prompt or empty after stripping).
 *   - Last resort: the raw title.
 */
export function displayTitle(session) {
  if (!session) return ''
  const title = session.title || ''
  // If title has the headless prefix → strip it as the cleanest source.
  if (HEADLESS_PREFIX_RE.test(title)) {
    return _strip(title) || title
  }
  // If the title is itself an auto-generated mess (trailing timestamp),
  // prefer the cleaned project name when available.
  if (TRAILING_ID_RE.test(title)) {
    const fromProject = _strip(session.project)
    if (fromProject) return fromProject
    return _strip(title) || title
  }
  // Title is "clean" (user-set or short auto-title); return as-is.
  return title
}

/**
 * Returns a clean display project name (used in the agent card's project
 * row).  Always strips the auto-generation noise; falls back to the raw
 * project string only if stripping produces nothing.
 */
export function displayProject(session) {
  if (!session?.project) return ''
  return _strip(session.project) || session.project
}

// Static glyph for headless sessions — replaces the live status icon
// because interaction with a headless run is fundamentally different
// (no PTY to attach to, no question-prompt cycle).
export const HEADLESS_ICON = '⧉'

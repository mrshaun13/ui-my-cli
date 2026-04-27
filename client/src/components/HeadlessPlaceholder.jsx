/**
 * HeadlessPlaceholder — shown when the user clicks a headless session in the
 * sidebar (i.e. opens its tab in "terminal" mode).  Headless runs are not
 * attached to a PTY and were launched out-of-band, so there is nothing for
 * xterm to connect to.  The summary view (clicking the status icon → preview
 * mode) is unchanged.
 */

import { displayTitle, HEADLESS_ICON } from '../lib/headless.js'

export default function HeadlessPlaceholder({ session, onPreview }) {
  if (!session) return null
  const title = displayTitle(session)

  return (
    <div className="headless-placeholder">
      <div className="headless-placeholder-card">
        <div className="headless-placeholder-icon">{HEADLESS_ICON}</div>
        <h2 className="headless-placeholder-title">{title}</h2>
        <div className="headless-placeholder-subtitle">headless run · {session.project}</div>

        <p className="headless-placeholder-body">
          This session was launched in <strong>headless mode</strong>, so there's
          no live terminal to attach to.
        </p>

        <p className="headless-placeholder-body">
          Direct interaction with headless agents is coming soon — get excited for
          deeper integrations between agentic tools.  For now, you can browse the
          full transcript, prompts, model usage, and tool calls in the summary view.
        </p>

        {onPreview && (
          <button
            className="headless-placeholder-cta"
            onClick={() => onPreview(session.id)}
          >
            Open summary →
          </button>
        )}

        <div className="headless-placeholder-meta">
          <code>{session.id}</code>
        </div>
      </div>
    </div>
  )
}

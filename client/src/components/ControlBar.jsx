/**
 * ControlBar — always-visible context strip at the bottom of the UI.
 *
 * Shows:
 *   - Plain-English status explanation ("Devin finished and is waiting for your reply")
 *   - Last message snippet — so you immediately know WHAT it needs without scrolling
 *   - Working directory
 *   - Rename button
 *   - Archive session button (hides from dashboard, kills PTY — reversible via sidebar drawer)
 */

import { useState, useEffect } from 'react'
import ContextPieChart from './ContextPieChart.jsx'
import { isHeadless, displayTitle, HEADLESS_ICON } from '../lib/headless.js'

const STATUS_EXPLANATION = {
  question: 'Devin finished and is waiting for your reply',
  active:   'Devin is actively working',
  finished: 'Devin has finished — no reply needed',
  idle:     'No recent activity',
}

const STATUS_COLOR = {
  question: 'var(--yellow)',
  active:   'var(--blue)',
  finished: 'var(--accent)',
  idle:     'var(--text-muted)',
}

export default function ControlBar({ session, sessionId, onRename, onRemove }) {
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [confirming, setConfirming] = useState(false)

  // Reset transient UI state when switching sessions
  useEffect(() => {
    setConfirming(false)
    setRenaming(false)
  }, [sessionId])

  if (!session) {
    return (
      <div className="controlbar" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '56px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          SELECT AN AGENT TO BEGIN
        </span>
      </div>
    )
  }

  const headless = isHeadless(session)

  const startRename = () => {
    // Pre-fill the input with the cleaned display title for headless sessions —
    // the user almost certainly doesn't want to edit the `headless-MMDDYYYY-`
    // prefix character-by-character. They can still type it back if they want.
    setNameValue(headless ? displayTitle(session) : session.title)
    setRenaming(true)
  }

  const commitRename = () => {
    setRenaming(false)
    const trimmed = nameValue.trim()
    if (trimmed) onRename(session.id, trimmed)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setRenaming(false)
  }

  const handleArchive = () => {
    if (!confirming) { setConfirming(true); return }
    setConfirming(false)
    onRemove(session.id)
  }

  const statusColor = headless ? 'var(--purple)' : (STATUS_COLOR[session.status] || 'var(--text-muted)')
  const explanation = headless
    ? 'Headless run — no live terminal'
    : (STATUS_EXPLANATION[session.status] || session.status)

  return (
    <div className="controlbar">
      <div className="controlbar-top-row">
        <div className="controlbar-session-info">
          <div className="controlbar-status-line">
            <span className="controlbar-status-dot" style={{ background: statusColor }} />
            <span style={{ color: statusColor, fontSize: '11px', fontWeight: 600 }}>
              {explanation}
            </span>
            {session.snippet && session.status === 'question' && (
              <span className="controlbar-snippet" title={session.snippet}>
                — "{session.snippet}"
              </span>
            )}
          </div>
          <div className="controlbar-session-path" title={session.workingDir}>
            <code style={{ color: 'var(--accent-dim)', marginRight: '8px' }}>
              {session.id.slice(0, 8)}
            </code>
            {session.workingDir}
          </div>
        </div>

        <div className="controlbar-actions">
          {/* PTY shortcuts only apply to interactive sessions — hide for headless. */}
          {!headless && (
            <>
              <div className="controlbar-shortcuts">
                <span className="shortcut-hint"><kbd>Alt+T</kbd> thinking</span>
                <span className="shortcut-hint"><kbd>!</kbd> shell</span>
                <span className="shortcut-hint"><kbd>Ctrl+C</kbd> clear line</span>
                <span className="shortcut-hint"><kbd>Ctrl+Enter</kbd> newline</span>
              </div>
              <div className="controlbar-divider" />
            </>
          )}
          {headless && (
            <>
              <span className="shortcut-hint" style={{ color: 'var(--purple)' }}>
                {HEADLESS_ICON} headless
              </span>
              <div className="controlbar-divider" />
            </>
          )}
          <ContextPieChart sessionId={sessionId} tooltipPosition="above" />
          <div className="controlbar-divider" />
          {renaming ? (
            <>
              <input
                autoFocus
                className="controlbar-rename-input"
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={onKeyDown}
              />
              <button className="btn btn-primary" onClick={commitRename}>Save</button>
              <button className="btn" onClick={() => setRenaming(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={startRename} title="Rename this session (also double-click in sidebar)">
                ✎ Rename
              </button>
              <button
                className={`btn ${confirming ? 'btn-danger' : ''}`}
                onClick={handleArchive}
                onBlur={() => setConfirming(false)}
                title="Archive session — hides it from the dashboard (reversible via sidebar)"
              >
                {confirming ? '⚠ Confirm archive' : '⊘ Archive'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


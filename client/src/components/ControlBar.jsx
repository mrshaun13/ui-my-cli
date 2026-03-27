/**
 * ControlBar — always-visible context strip at the bottom of the UI.
 *
 * Shows:
 *   - Plain-English status explanation ("Devin finished and is waiting for your reply")
 *   - Last message snippet — so you immediately know WHAT it needs without scrolling
 *   - Working directory
 *   - Rename button
 *
 * Removed: "Disconnect PTY" — it was confusing and the auto-reconnect made it a no-op.
 */

import { useState } from 'react'

const STATUS_EXPLANATION = {
  needs_you: 'Devin finished and is waiting for your reply',
  running:   'Devin is actively working',
  thinking:  'Devin is processing your last message',
  ready:     'Agent is ready — send a new task',
  idle:      'No recent activity',
}

const STATUS_COLOR = {
  needs_you: 'var(--yellow)',
  running:   'var(--blue)',
  thinking:  'var(--purple)',
  ready:     'var(--accent)',
  idle:      'var(--text-muted)',
}

export default function ControlBar({ session, onRename }) {
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState('')

  if (!session) {
    return (
      <div className="controlbar" style={{ justifyContent: 'center' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          SELECT AN AGENT TO BEGIN
        </span>
      </div>
    )
  }

  const startRename = () => {
    setNameValue(session.alias || session.title)
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

  const statusColor = STATUS_COLOR[session.status] || 'var(--text-muted)'
  const explanation = STATUS_EXPLANATION[session.status] || session.status

  return (
    <div className="controlbar">
      <div className="controlbar-session-info">
        {/* Status line — plain English so you know what's happening */}
        <div className="controlbar-status-line">
          <span className="controlbar-status-dot" style={{ background: statusColor }} />
          <span style={{ color: statusColor, fontSize: '11px', fontWeight: 600 }}>
            {explanation}
          </span>
          {session.snippet && session.status === 'needs_you' && (
            <span className="controlbar-snippet" title={session.snippet}>
              — "{session.snippet}"
            </span>
          )}
        </div>
        {/* Secondary line: path + session ID */}
        <div className="controlbar-session-path" title={session.workingDir}>
          <code style={{ color: 'var(--accent-dim)', marginRight: '8px' }}>
            {session.id.slice(0, 8)}
          </code>
          {session.workingDir}
        </div>
      </div>

      <div className="controlbar-actions">
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
          <button className="btn" onClick={startRename} title="Rename this session (also double-click in sidebar)">
            ✎ Rename
          </button>
        )}
      </div>
    </div>
  )
}

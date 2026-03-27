/**
 * ControlBar — always-visible action strip at the bottom of the UI.
 *
 * Shows context about the active session and provides click-to-act controls.
 * No keybindings to memorize.
 */

import { useState } from 'react'
import { StatusBadge } from './AgentCard.jsx'

export default function ControlBar({ session, ptyActive, onKillPty, onRename }) {
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

  return (
    <div className="controlbar">
      <div className="controlbar-session-info">
        <div className="controlbar-session-id">
          <StatusBadge status={session.status} />
          &nbsp;&nbsp;
          <code style={{ color: 'var(--accent-dim)', fontSize: '10px' }}>
            {session.id.slice(0, 8)}
          </code>
        </div>
        <div className="controlbar-session-path" title={session.workingDir}>
          {session.workingDir}
        </div>
      </div>

      <div className="controlbar-actions">
        {renaming ? (
          <>
            <input
              autoFocus
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent-dim)',
                borderRadius: '4px',
                color: 'var(--text-primary)',
                padding: '4px 8px',
                outline: 'none',
                width: '180px',
              }}
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
            {ptyActive && (
              <button
                className="btn btn-warn"
                onClick={() => onKillPty(session.id)}
                title="Disconnect the terminal (does not kill the Devin session)"
              >
                ⏹ Disconnect PTY
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

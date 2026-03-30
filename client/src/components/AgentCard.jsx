/**
 * AgentCard — one row in the sidebar representing a Devin session.
 *
 * Features:
 *  - Status icon with color-coded state (needs_you, running, thinking, idle, ready)
 *  - Project/repo name always visible below the title
 *  - Double-click title to rename inline
 *  - Shows last-message snippet and relative time
 *  - Optional label chip: shown if session.label is set and is NOT a status marker
 *
 * Note: ThinkingDots are used by the status icon (and re-exported for StatusBadge)
 * but intentionally NOT shown in the snippet area to avoid flicker on status changes.
 */

import { useState, useRef, useEffect } from 'react'

const STATUS_ICON = {
  needs_you: '⚡',
  running:   '⚙',
  thinking:  '◎',
  idle:      '·',
}

const STATUS_LABEL = {
  needs_you: 'needs you',
  running:   'running',
  thinking:  'thinking',
  idle:      'idle',
}

export function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: '2px', alignItems: 'center' }}>
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </span>
  )
}

export function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status}`}>
      {STATUS_ICON[status] ?? '·'}
      {status === 'thinking' ? <ThinkingDots /> : (STATUS_LABEL[status] ?? status)}
    </span>
  )
}

export default function AgentCard({ session, isActive, onClick, onRename, onRemove }) {
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState(session.title)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!renaming) setNameValue(session.title)
  }, [session.title, renaming])

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  const startRename = (e) => {
    e.stopPropagation()
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
    if (e.key === 'Escape') { setRenaming(false); setNameValue(session.title) }
    e.stopPropagation()
  }

  return (
    <div
      className={`agent-card ${isActive ? 'active' : ''} ${session.status}`}
      onClick={onClick}
      title={session.workingDir}
    >
      <div className={`agent-status-icon ${session.status}`}>
        {STATUS_ICON[session.status] ?? '·'}
      </div>

      <div className="agent-title-row">
        {renaming ? (
          <input
            ref={inputRef}
            className="agent-rename-input"
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={onKeyDown}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className="agent-title"
            onDoubleClick={startRename}
            title="Double-click to rename"
          >
            {session.title}
          </span>
        )}
        {session.label && (
          <span className="agent-label-chip">{session.label}</span>
        )}
        <span className="agent-time">{session.lastActivityAgo}</span>
      </div>

      {/* Project/repo — always visible so you know which repo before clicking */}
      <div className="agent-project">
        <span className="agent-project-icon">▶</span>
        {session.project}
      </div>

      {/* Snippet: always show last message text — never animated dots */}
      <div className="agent-snippet">
        {session.snippet || session.workingDir}
      </div>

      {/* Remove button — visible on hover */}
      <button
        className="agent-remove-btn"
        title="Remove session"
        onClick={e => { e.stopPropagation(); onRemove(session.id) }}
      >✕</button>
    </div>
  )
}

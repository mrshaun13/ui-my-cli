/**
 * AgentCard — one row in the sidebar representing a Devin session.
 *
 * Click targets:
 *   Status icon (left square)  → onPreview(id)  — opens read-only preview, no PTY
 *   Rest of card               → onClick(id)    — opens live terminal (existing behavior)
 *
 * Props:
 *   isOld     — true when idle + older than cold threshold. Dims card, shows Archive btn.
 *   onArchive — called with session.id to archive the session.
 *   onPreview — called with session.id to open the read-only preview panel.
 */

import { useState, useRef, useEffect, memo } from 'react'

export const STATUS_ICON = {
  question: '⚡',
  active:   '⚙',
  finished: '✓',
  idle:     '·',
}

export const STATUS_LABEL = {
  question: 'needs you',
  active:   'running',
  finished: 'finished',
  idle:     'idle',
}

export function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status}`}>
      {STATUS_ICON[status] ?? '·'}
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export default memo(function AgentCard({ session, isActive, isPreview, isOld, compact, onClick, onPreview, onRename, onArchive }) {
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState(session.title)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!renaming) setNameValue(session.title)
  }, [session.title, renaming])

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  // ── Compact mode (collapsed sidebar) ─────────────────────────────
  if (compact) {
    return (
      <div
        className={`agent-card-compact ${session.status}${isActive ? ' active' : ''}${isPreview ? ' previewing' : ''}`}
        onClick={onClick}
      >
        <div className={`agent-status-icon ${session.status}${isPreview ? ' previewing' : ''}`}>
          {STATUS_ICON[session.status] ?? '·'}
        </div>
      </div>
    )
  }

  const startRename = (e) => {
    e.stopPropagation()
    setNameValue(session.title)
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

  const cardClasses = [
    'agent-card',
    isActive   ? 'active'           : '',
    isPreview  ? 'previewing'       : '',
    session.status,
    isOld      ? 'agent-card-old'   : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={cardClasses}
      onClick={onClick}
      title={session.workingDir}
    >
      {/* ── Status icon — click = preview, no PTY spawn ─────────── */}
      <div
        className={`agent-status-icon ${session.status}${isPreview ? ' previewing' : ''}`}
        role="button"
        tabIndex={0}
        onClick={e => { e.stopPropagation(); onPreview && onPreview(session.id) }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPreview && onPreview(session.id) } }}
        title="Click to preview session (read-only, no PTY)"
      >
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
        <span className="agent-time">{session.lastActivityAgo}</span>
      </div>

      <div className="agent-project">
        <span className="agent-project-icon">▶</span>
        {session.project}
        {session.hasSubagents && (
          <span className="agent-subagent-badge" title="Session used subagents">⑂</span>
        )}
      </div>

      {/* Old+idle: one-click archive button (no confirm — reversible) */}
      {isOld ? (
        <button
          className="agent-archive-btn agent-archive-btn-old"
          title="Archive session (reversible)"
          onClick={e => { e.stopPropagation(); onArchive(session.id) }}
        >
          ⊘ Archive
        </button>
      ) : (
        <button
          className="agent-remove-btn"
          title="Archive session"
          onClick={e => { e.stopPropagation(); onArchive(session.id) }}
        >✕</button>
      )}
    </div>
  )
})


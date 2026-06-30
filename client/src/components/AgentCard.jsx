/**
 * AgentCard — one row in the sidebar representing a provider session.
 *
 * Click targets:
 *   Status icon (left square)  → onPreview(id)  — opens read-only preview, no PTY
 *   Rest of card               → onClick(id)    — opens live terminal (existing behavior)
 *
 * Props:
 *   isOld      — true when idle + older than cold threshold. Dims card, shows Archive btn.
 *   isArchived — true for archived sessions in search results. Dims card, shows Restore btn.
 *   onArchive  — called with session.id to archive the session.
 *   onRestore  — called with session.id to restore an archived session.
 *   onPreview  — called with session.id to open the read-only preview panel.
 */

import { useState, useRef, useEffect, memo } from 'react'
import { isHeadless, displayTitle, displayProject, HEADLESS_ICON } from '../lib/headless.js'

// Re-exported so Sidebar.jsx can keep its single import-from-AgentCard line
// alongside STATUS_ICON / STATUS_LABEL.  The canonical definition lives in
// lib/headless.js.
export { HEADLESS_ICON }

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

export default memo(function AgentCard({ session, isActive, isPreview, isOld, isArchived, compact, onClick, onPreview, onRename, onArchive, onRestore }) {
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState(session.title)
  const inputRef = useRef(null)

  const headless = isHeadless(session)
  const shownTitle = headless ? displayTitle(session) : session.title
  const shownProject = headless ? displayProject(session) : session.project

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
        className={`agent-card-compact ${session.status}${isActive ? ' active' : ''}${isPreview ? ' previewing' : ''}${headless ? ' headless' : ''}`}
        onClick={onClick}
      >
        <div className={`agent-status-icon ${headless ? 'headless' : session.status}${isPreview ? ' previewing' : ''}`}>
          {headless ? HEADLESS_ICON : (STATUS_ICON[session.status] ?? '·')}
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
    isActive   ? 'active'               : '',
    isPreview  ? 'previewing'           : '',
    session.status,
    isOld      ? 'agent-card-old'       : '',
    isArchived ? 'agent-card-archived'  : '',
    headless   ? 'agent-card-headless'  : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={cardClasses}
      onClick={onClick}
      title={session.workingDir}
    >
      {/* ── Status icon — click = preview, no PTY spawn ─────────── */}
      <div
        className={`agent-status-icon ${headless ? 'headless' : session.status}${isPreview ? ' previewing' : ''}`}
        role="button"
        tabIndex={0}
        onClick={e => { e.stopPropagation(); onPreview && onPreview(session.id) }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPreview && onPreview(session.id) } }}
        title={headless ? 'Headless run — click to view summary' : 'Click to preview session (read-only, no PTY)'}
      >
        {headless ? HEADLESS_ICON : (STATUS_ICON[session.status] ?? '·')}
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
            title={headless ? session.title : 'Double-click to rename'}
          >
            {shownTitle}
          </span>
        )}
        <span className="agent-time">{session.lastActivityAgo}</span>
        {isArchived && <span className="agent-archived-badge">archived</span>}
      </div>

      <div className="agent-project">
        <span className="agent-project-icon">▶</span>
        {shownProject}
        <span className="agent-hash" title={session.id}>
          {session.id.startsWith('pending-') ? 'pending' : session.id.slice(0, 8)}
        </span>
        {session.hasSubagents && (
          <span className="agent-subagent-badge" title="Session used subagents">⑂</span>
        )}
      </div>

      {/* Old+idle: one-click archive button (no confirm — reversible) */}
      {isArchived ? (
        <button
          className="agent-archive-btn agent-restore-btn"
          title="Restore to active sessions"
          onClick={e => { e.stopPropagation(); onRestore(session.id) }}
        >
          ↩ Restore
        </button>
      ) : isOld ? (
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

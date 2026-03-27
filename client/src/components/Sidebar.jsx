/**
 * Sidebar — left panel listing all Devin sessions grouped by project/repo.
 *
 * Grouping: sessions are bucketed by `session.project` (basename of workingDir).
 * "Needs You" filter: when active, only shows sessions with status=needs_you.
 * Groups with no matching sessions are hidden in filter mode.
 */

import { useState, useMemo } from 'react'
import AgentCard from './AgentCard.jsx'

const STATUS_SORT_ORDER = { needs_you: 0, running: 1, thinking: 2, idle: 3 }

function groupByProject(sessions) {
  const groups = new Map()
  for (const s of sessions) {
    const key = s.project || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  return groups
}

export default function Sidebar({ sessions, selectedId, onSelect, onRename, filterNeedsYou, onToggleFilter }) {
  const [collapsed, setCollapsed] = useState(new Set())

  const filtered = filterNeedsYou
    ? sessions.filter(s => s.status === 'needs_you')
    : sessions

  const sorted = useMemo(() => (
    [...filtered].sort((a, b) => (STATUS_SORT_ORDER[a.status] ?? 4) - (STATUS_SORT_ORDER[b.status] ?? 4))
  ), [filtered])

  const groups = useMemo(() => groupByProject(sorted), [sorted])

  const needsYouCount = sessions.filter(s => s.status === 'needs_you').length

  const toggleCollapse = (key) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  if (sessions.length === 0) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section-header">
          Sessions
        </div>
        <div className="sidebar-empty">
          <div className="sidebar-empty-icon">◎</div>
          <div className="sidebar-empty-text">
            No sessions found.<br />
            Run <code>devin</code> to start an agent.
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-section-header">
        <span>Sessions</span>
        {needsYouCount > 0 && (
          <button
            className={`filter-btn ${filterNeedsYou ? 'active' : ''}`}
            onClick={onToggleFilter}
            title="Show only sessions waiting for your input"
          >
            ⚡ {needsYouCount} waiting
          </button>
        )}
        <span className="count">{sessions.length}</span>
      </div>

      {[...groups.entries()].map(([project, projectSessions]) => {
        const isOpen = !collapsed.has(project)
        return (
          <div key={project} className="sidebar-group">
            <div
              className="sidebar-group-label"
              onClick={() => toggleCollapse(project)}
            >
              <span style={{ color: 'var(--accent-dim)', fontSize: '10px' }}>▶</span>
              {project}
              <span className="chevron" style={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }}>›</span>
            </div>

            {isOpen && projectSessions.map(session => (
              <AgentCard
                key={session.id}
                session={session}
                isActive={session.id === selectedId}
                onClick={() => onSelect(session.id)}
                onRename={onRename}
              />
            ))}
          </div>
        )
      })}
    </aside>
  )
}

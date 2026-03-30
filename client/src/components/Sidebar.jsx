/**
 * Sidebar — left panel listing all Devin sessions as a flat sorted list.
 *
 * Sort order: needs_you first, then ready, then everything else, all sub-sorted
 * by lastActivityAt DESC (most recently active at top).
 *
 * Repo filter chips: one per unique project value; clicking a chip toggles
 * that repo's sessions on/off. All repos visible by default.
 */

import { useState, useMemo } from 'react'
import AgentCard from './AgentCard.jsx'

export default function Sidebar({ sessions, selectedId, onSelect, onRename, filterNeedsYou, onToggleFilter }) {
  // hiddenRepos: set of project names the user has toggled OFF
  const [hiddenRepos, setHiddenRepos] = useState(new Set())

  // All unique repos from all sessions (for filter chips)
  const allRepos = useMemo(() => {
    const repos = [...new Set(sessions.map(s => s.project).filter(Boolean))]
    return repos.sort()
  }, [sessions])

  const toggleRepo = (repo) => {
    setHiddenRepos(prev => {
      const next = new Set(prev)
      next.has(repo) ? next.delete(repo) : next.add(repo)
      return next
    })
  }

  // Filter: hidden repos + needs_you filter
  const filtered = useMemo(() => {
    let list = sessions.filter(s => !hiddenRepos.has(s.project))
    if (filterNeedsYou) list = list.filter(s => s.status === 'needs_you')
    return list
  }, [sessions, hiddenRepos, filterNeedsYou])

  // Sort: needs_you/ready float up, then by lastActivityAt DESC
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const priority = { needs_you: 0, ready: 1 }
      const pa = priority[a.status] ?? 2
      const pb = priority[b.status] ?? 2
      if (pa !== pb) return pa - pb
      return b.lastActivityAt - a.lastActivityAt
    })
  }, [filtered])

  const needsYouCount = sessions.filter(s => s.status === 'needs_you').length

  if (sessions.length === 0) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section-header">Sessions</div>
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
        <span className="count">{sorted.length}</span>
      </div>

      {/* Repo filter chips — only show if there are 2+ repos */}
      {allRepos.length > 1 && (
        <div className="sidebar-repo-filters">
          {allRepos.map(repo => (
            <button
              key={repo}
              className={`repo-chip ${hiddenRepos.has(repo) ? 'off' : 'on'}`}
              onClick={() => toggleRepo(repo)}
              title={hiddenRepos.has(repo) ? `Show ${repo} agents` : `Hide ${repo} agents`}
            >
              {repo}
            </button>
          ))}
        </div>
      )}

      {/* Flat sorted list */}
      {sorted.map(session => (
        <AgentCard
          key={session.id}
          session={session}
          isActive={session.id === selectedId}
          onClick={() => onSelect(session.id)}
          onRename={onRename}
        />
      ))}
    </aside>
  )
}

/**
 * Sidebar — left panel listing all Devin sessions.
 *
 * Features:
 *  - Repo filter pills (persist to localStorage)
 *  - Auto-grouping: sessions idle > coldDays days sink under an "── older ──" divider
 *  - coldDays threshold is user-configurable (gear icon → inline input, persists to localStorage)
 *  - One-click archive on old+idle cards (no confirm needed — reversible)
 *  - Archive drawer at bottom: "N archived" link → expands to show hidden sessions with Restore
 *  - Free-text search box: instant client-side pre-filter + 200ms debounced server search
 *    across title, project, prompt history, and user-role message content
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import AgentCard from './AgentCard.jsx'
import { STATUS_ICON, STATUS_LABEL } from './AgentCard.jsx'
import { useRepoFilter } from '../hooks/useRepoFilter.js'

const STORAGE_COLD             = 'devin-dash:cold-days'
const STORAGE_SEARCH_ARCHIVED  = 'devin-dash:search-archived'
const DEFAULT_COLD             = 3

function loadColdDays() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_COLD), 10)
    if (!isNaN(v) && v > 0) return v
  } catch { /* ignore */ }
  return DEFAULT_COLD
}

function saveColdDays(n) {
  try { localStorage.setItem(STORAGE_COLD, String(n)) } catch { /* ignore */ }
}

function loadSearchArchived() {
  try { return localStorage.getItem(STORAGE_SEARCH_ARCHIVED) === 'true' } catch { return false }
}

function saveSearchArchived(v) {
  try { localStorage.setItem(STORAGE_SEARCH_ARCHIVED, String(v)) } catch { /* ignore */ }
}

// ── New Session FAB — floating button at bottom-right of sidebar ─────────────

function NewSessionFAB({ onCreateSession }) {
  const [open, setOpen]         = useState(false)
  const [repos, setRepos]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const [creating, setCreating] = useState(false)
  const fabRef = useRef(null)

  const fetchRepos = useCallback(() => {
    setLoading(true)
    fetch('/api/repos')
      .then(r => r.json())
      .then(d => { setRepos(d); setLoading(false) })
      .catch(() => { setRepos([]); setLoading(false) })
  }, [])

  const toggle = () => {
    if (!open) fetchRepos()
    setOpen(v => !v)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (fabRef.current && !fabRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = async (workingDir) => {
    setCreating(true)
    setOpen(false)
    try {
      await onCreateSession(workingDir)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="new-session-fab-wrap" ref={fabRef}>
      {open && (
        <div className="new-session-dropdown">
          {loading && <div className="new-session-dropdown-empty">Loading…</div>}
          {!loading && repos?.length === 0 && (
            <div className="new-session-dropdown-empty">No repos found.</div>
          )}
          {!loading && repos?.map(r => (
            <button
              key={r.workingDir}
              className="repo-add-option"
              onClick={() => handleSelect(r.workingDir)}
              title={r.workingDir}
            >
              {r.project}
            </button>
          ))}
        </div>
      )}
      <button
        className={`new-session-fab${creating ? ' creating' : ''}`}
        onClick={toggle}
        disabled={creating}
        title="Start a new Devin session"
      >
        {creating ? <span className="spinner" /> : '+'}
      </button>
    </div>
  )
}

// ── Archive drawer — lazy-fetches archived sessions on open ──────────────────

function ArchiveDrawer({ onRestore }) {
  const [open, setOpen]           = useState(false)
  const [sessions, setSessions]   = useState(null)
  const [loading, setLoading]     = useState(false)

  const fetchArchived = useCallback(() => {
    setLoading(true)
    fetch('/api/sessions/archived')
      .then(r => r.json())
      .then(d => { setSessions(d); setLoading(false) })
      .catch(() => { setSessions([]); setLoading(false) })
  }, [])

  const toggle = () => {
    if (!open) fetchArchived()
    setOpen(v => !v)
  }

  const handleRestore = (id) => {
    onRestore(id)
    // Optimistically remove from local list
    setSessions(prev => prev?.filter(s => s.id !== id) ?? [])
  }

  return (
    <div className="archive-drawer">
      <button className="archive-drawer-toggle" onClick={toggle}>
        <span className="archive-drawer-icon">{open ? '▾' : '▸'}</span>
        {open ? 'Archived' : 'Archived'}
        {sessions !== null && <span className="sidebar-count"> ({sessions.length})</span>}
      </button>

      {open && (
        <div className="archive-drawer-body">
          {loading && (
            <div className="archive-drawer-empty">Loading…</div>
          )}
          {!loading && sessions?.length === 0 && (
            <div className="archive-drawer-empty">Nothing archived yet.</div>
          )}
          {!loading && sessions?.map(s => (
            <div key={s.id} className="archive-row">
              <div className="archive-row-info">
                <span className="archive-row-title">{s.title}</span>
                <span className="archive-row-meta">{s.project} · {s.lastActivityAgo}</span>
                {s.firstUserPrompt && (
                  <span className="archive-row-prompt">{s.firstUserPrompt.slice(0, 80)}</span>
                )}
              </div>
              <button
                className="btn btn-restore"
                onClick={() => handleRestore(s.id)}
                title="Restore to active sessions"
              >
                ↩ Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Sidebar ─────────────────────────────────────────────────────────────

export default function Sidebar({ sessions, selectedId, previewId, collapsed, onToggleCollapse, onSelect, onPreview, onRename, onRemove, onRestore, filterNeedsYou, onToggleFilter, onCreateSession }) {
  const {
    repoFilter, allRepos, addedRepos,
    sortedHiddenRepos, activeRepos, repoSessionCounts,
    addRepo, removeRepo, toggleRepo,
  } = useRepoFilter(sessions)

  const [addOpen, setAddOpen]           = useState(false)
  const [dropdownSearch, setDropdownSearch] = useState('')
  const [coldDays, setColdDays]         = useState(loadColdDays)
  const [editingCold, setEditingCold]   = useState(false)
  const [coldInput, setColdInput]       = useState(String(coldDays))
  const addRef  = useRef(null)
  const coldRef = useRef(null)

  // ── Search state ────────────────────────────────────────────────────────────
  const [searchQuery,    setSearchQuery]    = useState('')
  const [searchFocused,  setSearchFocused]  = useState(false)
  const [searchArchived, setSearchArchived] = useState(loadSearchArchived)
  // serverResults: null = not yet fetched / cleared; array = server response
  const [serverResults,  setServerResults]  = useState(null)
  const searchInputRef = useRef(null)
  const searchTimerRef = useRef(null)

  // Instant client-side filter — updates immediately on each 3s feed tick
  // so results stay fresh without re-hitting the server.
  const clientFiltered = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    return sessions.filter(s =>
      s.title?.toLowerCase().includes(q) ||
      s.project?.toLowerCase().includes(q) ||
      s.firstUserPrompt?.toLowerCase().includes(q) ||
      s.lastUserPrompt?.toLowerCase().includes(q)
    )
  }, [searchQuery, sessions])

  // Debounced server fetch — only re-fires when query or archived flag changes,
  // not on every 3s feed tick (sessions is intentionally excluded from deps).
  useEffect(() => {
    clearTimeout(searchTimerRef.current)
    if (!searchQuery.trim()) {
      setServerResults(null)
      return
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/sessions/search?q=${encodeURIComponent(searchQuery)}&archived=${searchArchived ? 1 : 0}`
        )
        if (res.ok) setServerResults(await res.json())
      } catch { /* ignore — client filter still showing */ }
    }, 200)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery, searchArchived]) // eslint-disable-line react-hooks/exhaustive-deps

  // What to display: server results take priority; fall back to client filter while in flight
  const displayResults = searchQuery.trim()
    ? (serverResults ?? clientFiltered ?? [])
    : null

  const handleSearchArchivedChange = (v) => {
    setSearchArchived(v)
    saveSearchArchived(v)
  }

  const clearSearch = () => {
    setSearchQuery('')
    setServerResults(null)
  }

  // Close repo-add dropdown on outside click
  useEffect(() => {
    if (!addOpen) return
    const handler = (e) => {
      if (addRef.current && !addRef.current.contains(e.target)) {
        setAddOpen(false)
        setDropdownSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addOpen])

  // Close cold-days editor on outside click
  useEffect(() => {
    if (!editingCold) return
    const handler = (e) => {
      if (coldRef.current && !coldRef.current.contains(e.target)) commitCold()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editingCold])

  const handleAddRepo = (repo) => {
    addRepo(repo)
    setAddOpen(false)
    setDropdownSearch('')
  }

  // Dropdown search filter
  const filteredDropdown = useMemo(() => {
    if (!dropdownSearch.trim()) return sortedHiddenRepos
    const q = dropdownSearch.toLowerCase()
    return sortedHiddenRepos.filter(r => r.toLowerCase().includes(q))
  }, [sortedHiddenRepos, dropdownSearch])

  const commitCold = () => {
    const n = parseInt(coldInput, 10)
    if (!isNaN(n) && n > 0) { setColdDays(n); saveColdDays(n) }
    else setColdInput(String(coldDays))
    setEditingCold(false)
  }

  // Round to 60s granularity — the hot/cold boundary is measured in days,
  // so per-second precision just busts the useMemo cache on every render.
  const nowSec = Math.floor(Date.now() / 60000) * 60
  const coldSec = coldDays * 86400

  // Filter by active repos + question toggle
  const filtered = useMemo(() => {
    if (!repoFilter) return []
    let list = sessions.filter(s => activeRepos.has(s.project))
    if (filterNeedsYou) list = list.filter(s => s.status === 'question')
    return list
  }, [sessions, repoFilter, activeRepos, filterNeedsYou])

  // Split into hot (recent) and cold (old+idle)
  const { hot, cold } = useMemo(() => {
    const hot = [], cold = []
    const sorted = [...filtered].sort((a, b) => {
      const pri = { question: 0, active: 1 }
      const pa = pri[a.status] ?? 1
      const pb = pri[b.status] ?? 1
      if (pa !== pb) return pa - pb
      return b.lastActivityAt - a.lastActivityAt
    })
    for (const s of sorted) {
      const age = nowSec - s.lastActivityAt
      // Cold = idle AND older than threshold
      if (s.status === 'idle' && age >= coldSec) cold.push(s)
      else hot.push(s)
    }
    return { hot, cold }
  }, [filtered, coldSec, nowSec])

  const needsYouCount = sessions.filter(s => s.status === 'question').length

  // Whether the archived option row should be visible
  const showSearchOption = searchFocused || !!searchQuery

  // ── Flyout tooltip for collapsed mode ──────────────────────────────────────
  const [tooltip, setTooltip] = useState(null)

  const showTooltip = useCallback((session, e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({
      title: session.title,
      project: session.project,
      status: session.status,
      time: session.lastActivityAgo,
      top: rect.top,
      left: rect.right + 8,
    })
  }, [])

  const hideTooltip = useCallback(() => setTooltip(null), [])

  // ── Collapsed sidebar render ───────────────────────────────────────────────
  if (collapsed) {
    // Use filtered list (respects repo filter), combine hot + cold
    const allFiltered = [...hot, ...cold]
    return (
      <aside className="sidebar sidebar-collapsed">
        <div className="sidebar-collapsed-list">
          {allFiltered.map(session => (
            <div
              key={session.id}
              onMouseEnter={e => showTooltip(session, e)}
              onMouseLeave={hideTooltip}
            >
              <AgentCard
                session={session}
                isActive={session.id === selectedId}
                isPreview={session.id === previewId}
                isOld={false}
                compact
                onClick={() => onSelect(session.id)}
                onPreview={onPreview}
                onRename={onRename}
                onArchive={onRemove}
              />
            </div>
          ))}
          {allFiltered.length === 0 && sessions.length > 0 && (
            <div className="sidebar-collapsed-empty" title="No sessions match filter">—</div>
          )}
        </div>

        {/* Bottom area: FAB + expand toggle, stacked vertically */}
        <div className="sidebar-bottom-collapsed">
          <NewSessionFAB onCreateSession={onCreateSession} />
          <button
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title="Expand sidebar"
          >›</button>
        </div>

        {/* Flyout tooltip (fixed position, escapes sidebar overflow) */}
        {tooltip && createPortal(
          <div className="sidebar-flyout" style={{ top: tooltip.top, left: tooltip.left }}>
            <div className="sidebar-flyout-title">{tooltip.title}</div>
            <div className="sidebar-flyout-meta">{tooltip.project} · {tooltip.time}</div>
            <span className={`status-badge ${tooltip.status}`}>
              {STATUS_ICON[tooltip.status] ?? '·'} {STATUS_LABEL[tooltip.status] ?? tooltip.status}
            </span>
          </div>,
          document.body
        )}
      </aside>
    )
  }

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
        <div className="sidebar-archive-row">
          <div style={{ flex: 1 }} />
          <button
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
          >‹</button>
        </div>
        <NewSessionFAB onCreateSession={onCreateSession} />
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="sidebar-section-header">
        <span>
          Sessions{' '}
          <span className="sidebar-count">
            {displayResults
              ? `(${displayResults.length} of ${sessions.length})`
              : `(${sessions.length})`
            }
          </span>
        </span>

        {/* ⚡ filter — dimmed while search is active */}
        {needsYouCount > 0 && (
          <button
            className={`filter-btn ${filterNeedsYou ? 'active' : ''}`}
            onClick={onToggleFilter}
            title="Show only sessions waiting for your input"
            style={displayResults ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
          >
            ⚡ {needsYouCount}
          </button>
        )}

        {/* ── Search input ──────────────────────────────────────── */}
        <div className="sidebar-search-wrap">
          <input
            ref={searchInputRef}
            className="sidebar-search-input"
            type="text"
            placeholder="search…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                clearSearch()
                searchInputRef.current?.blur()
              }
            }}
          />
          {searchQuery && (
            <button
              className="sidebar-search-clear"
              // mousedown preventDefault keeps input focused while handling the click
              onMouseDown={e => e.preventDefault()}
              onClick={() => { clearSearch(); searchInputRef.current?.focus() }}
              title="Clear search (Esc)"
            >×</button>
          )}
        </div>

        {/* Cold-days threshold control — dimmed while search active */}
        <div
          className="cold-days-wrap"
          ref={coldRef}
          style={displayResults ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
        >
          {editingCold ? (
            <input
              className="cold-days-input"
              type="number"
              min="1"
              max="30"
              value={coldInput}
              onChange={e => setColdInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitCold(); if (e.key === 'Escape') { setEditingCold(false); setColdInput(String(coldDays)) } }}
              autoFocus
              title="Sessions idle longer than this many days are grouped as 'older'"
            />
          ) : (
            <button
              className="cold-days-btn"
              onClick={() => { setColdInput(String(coldDays)); setEditingCold(true) }}
              title={`Sessions idle > ${coldDays}d are grouped as older — click to change`}
            >
              ⏱ {coldDays}d
            </button>
          )}
        </div>
      </div>

      {/* ── "incl. archived" option — pops up when search is focused or active ── */}
      {showSearchOption && (
        <div
          className="sidebar-search-option"
          // Prevent this row from stealing focus away from the search input
          onMouseDown={e => e.preventDefault()}
        >
          <label className="sidebar-search-option-label">
            <input
              type="checkbox"
              checked={searchArchived}
              onChange={e => handleSearchArchivedChange(e.target.checked)}
            />
            incl. archived
          </label>
        </div>
      )}

      {/* ── Search results (flat list, bypasses repo/question filters) ─── */}
      {displayResults !== null ? (
        <>
          {displayResults.length === 0 ? (
            <div className="sidebar-empty" style={{ padding: '16px' }}>
              <div className="sidebar-empty-text">No sessions match "{searchQuery}".</div>
            </div>
          ) : (
            displayResults.map(session => (
              <AgentCard
                key={session.id}
                session={session}
                isActive={session.id === selectedId}
                isPreview={session.id === previewId}
                isOld={false}
                onClick={() => onSelect(session.id)}
                onPreview={onPreview}
                onRename={onRename}
                onArchive={onRemove}
              />
            ))
          )}
        </>
      ) : (
        <>
          {/* ── Repo filter pills ────────────────────────────────────── */}
          {allRepos.length > 1 && repoFilter && (
            <div className="sidebar-repo-filters">
              {addedRepos.map(repo => {
                const state = repoFilter.get(repo)
                return (
                  <span key={repo} className={`repo-chip ${state === 'active' ? 'on' : 'off'}`}>
                    <span
                      className="repo-chip-body"
                      onClick={() => toggleRepo(repo)}
                      title={state === 'active'
                        ? `Disable ${repo} (hide sessions)`
                        : `Enable ${repo} (show sessions)`}
                    >
                      {repo} <span className="repo-chip-count">({repoSessionCounts[repo] || 0})</span>
                    </span>
                    <span
                      className="repo-chip-x"
                      onClick={(e) => { e.stopPropagation(); removeRepo(repo) }}
                      title={`Remove ${repo} filter`}
                    >×</span>
                  </span>
                )
              })}
              {sortedHiddenRepos.length > 0 && (
                <div className="repo-add-wrap" ref={addRef}>
                  <button className="repo-chip repo-chip-add" onClick={() => setAddOpen(v => !v)} title="Add a project">+</button>
                  {addOpen && (
                    <div className="repo-add-dropdown">
                      <div className="repo-add-search-wrap">
                        <input
                          className="repo-add-search"
                          type="text"
                          placeholder="filter…"
                          value={dropdownSearch}
                          onChange={e => setDropdownSearch(e.target.value)}
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Escape') { setAddOpen(false); setDropdownSearch('') }
                          }}
                        />
                      </div>
                      {filteredDropdown.length === 0 && (
                        <div className="repo-add-empty">No matches</div>
                      )}
                      {filteredDropdown.map(repo => (
                        <button key={repo} className="repo-add-option" onClick={() => handleAddRepo(repo)}>
                          {repo} <span className="repo-chip-count">({repoSessionCounts[repo] || 0})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Active / recent sessions ─────────────────────────────── */}
          {hot.map(session => (
            <AgentCard
              key={session.id}
              session={session}
              isActive={session.id === selectedId}
              isPreview={session.id === previewId}
              isOld={false}
              onClick={() => onSelect(session.id)}
              onPreview={onPreview}
              onRename={onRename}
              onArchive={onRemove}
            />
          ))}

          {/* ── Older divider + cold sessions ───────────────────────── */}
          {cold.length > 0 && (
            <>
              <div className="sidebar-older-divider">
                <span>older</span>
              </div>
              {cold.map(session => (
                <AgentCard
                  key={session.id}
                  session={session}
                  isActive={session.id === selectedId}
                  isPreview={session.id === previewId}
                  isOld={true}
                  onClick={() => onSelect(session.id)}
                  onPreview={onPreview}
                  onRename={onRename}
                  onArchive={onRemove}
                />
              ))}
            </>
          )}

          {hot.length === 0 && cold.length === 0 && (
            <div className="sidebar-empty" style={{ padding: '16px' }}>
              <div className="sidebar-empty-text">No sessions match the current filter.</div>
            </div>
          )}
        </>
      )}

      {/* ── Archive drawer + collapse toggle ────────────────────────── */}
      <div className="sidebar-archive-row">
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >‹</button>
        <ArchiveDrawer onRestore={onRestore} />
      </div>

      {/* ── Floating new session button ──────────────────────────── */}
      <NewSessionFAB onCreateSession={onCreateSession} />
    </aside>
  )
}

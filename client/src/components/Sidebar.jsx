/**
 * Sidebar — left panel listing all sessions for the selected provider.
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

import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import AgentCard from './AgentCard.jsx'
import { STATUS_ICON, STATUS_LABEL, HEADLESS_ICON } from './AgentCard.jsx'
import { useRepoFilter } from '../hooks/useRepoFilter.js'
import { isHeadless, displayTitle } from '../lib/headless.js'
import { providerApiPath, providerStorageKey } from '../lib/providers.js'

function loadSearchArchived(providerId) {
  try { return localStorage.getItem(providerStorageKey(providerId, 'search-archived')) === 'true' } catch { return false }
}

function saveSearchArchived(providerId, v) {
  try { localStorage.setItem(providerStorageKey(providerId, 'search-archived'), String(v)) } catch { /* ignore */ }
}

// Headless section visibility — default true (user wants to see them by default).
function loadShowHeadless(providerId) {
  try {
    const raw = localStorage.getItem(providerStorageKey(providerId, 'show-headless'))
    if (raw === null) return true
    return raw === 'true'
  } catch { return true }
}

function saveShowHeadless(providerId, v) {
  try { localStorage.setItem(providerStorageKey(providerId, 'show-headless'), String(v)) } catch { /* ignore */ }
}

// ── New Session FAB — floating button at bottom-right of sidebar ─────────────

function NewSessionFAB({ providerId, providerLabel, onCreateSession }) {
  const [open, setOpen]         = useState(false)
  const [repos, setRepos]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const [creating, setCreating] = useState(false)
  const fabRef      = useRef(null)
  const dropdownRef = useRef(null)

  const fetchRepos = useCallback(() => {
    setLoading(true)
    fetch(providerApiPath(providerId, 'repos'))
      .then(r => r.json())
      .then(d => { setRepos(d); setLoading(false) })
      .catch(() => { setRepos([]); setLoading(false) })
  }, [])

  const toggle = () => {
    if (!open) fetchRepos()
    setOpen(v => !v)
  }

  // Close on outside click (check both the FAB and the portal'd dropdown)
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (fabRef.current?.contains(e.target)) return
      if (dropdownRef.current?.contains(e.target)) return
      setOpen(false)
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

  // Compute dropdown position from the FAB button's bounding rect
  // Reposition on scroll/resize to avoid stale coordinates
  const [dropdownStyle, setDropdownStyle] = useState({})
  useEffect(() => {
    if (!open || !fabRef.current) { setDropdownStyle({}); return }
    const reposition = () => {
      const rect = fabRef.current.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.bottom,
        left: rect.right + 6,
      })
    }
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  return (
    <div className="new-session-fab-wrap" ref={fabRef}>
      {open && createPortal(
        <div className="new-session-dropdown" ref={dropdownRef} style={dropdownStyle}>
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
        </div>,
        document.body
      )}
      <button
        className={`new-session-fab${creating ? ' creating' : ''}`}
        onClick={toggle}
        disabled={creating}
        title={`Start a new ${providerLabel} session`}
      >
        {creating ? <span className="spinner" /> : '+'}
      </button>
    </div>
  )
}

// ── Archive drawer — lazy-fetches archived sessions on open ──────────────────

function ArchiveDrawer({ providerId, onRestore }) {
  const [open, setOpen]           = useState(false)
  const [sessions, setSessions]   = useState(null)
  const [loading, setLoading]     = useState(false)

  const fetchArchived = useCallback(() => {
    setLoading(true)
    fetch(providerApiPath(providerId, 'sessions/archived'))
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

export default function Sidebar({ providerId, providerLabel, providerCommand, sessions, selectedId, previewId, collapsed, onToggleCollapse, onSelect, onPreview, onRename, onRemove, onRestore, filterNeedsYou, onToggleFilter, onCreateSession, coldDays, onSetColdDays }) {
  const {
    repoFilter, allRepos, addedRepos,
    sortedHiddenRepos, activeRepos, repoSessionCounts,
    addRepo, removeRepo, toggleRepo, addAllRepos, clearAllRepos,
  } = useRepoFilter(sessions, providerId)

  const [addOpen, setAddOpen]           = useState(false)
  const [dropdownSearch, setDropdownSearch] = useState('')
  const [editingCold, setEditingCold]   = useState(false)
  const [coldInput, setColdInput]       = useState(String(coldDays))
  const [showHeadless, setShowHeadless] = useState(() => loadShowHeadless(providerId))
  const addRef      = useRef(null)
  const addDropRef  = useRef(null)
  const coldRef     = useRef(null)

  const toggleShowHeadless = useCallback(() => {
    setShowHeadless(prev => {
      const next = !prev
      saveShowHeadless(providerId, next)
      return next
    })
  }, [providerId])

  // ── Search state ────────────────────────────────────────────────────────────
  const [searchQuery,    setSearchQuery]    = useState('')
  const [searchFocused,  setSearchFocused]  = useState(false)
  const [searchArchived, setSearchArchived] = useState(() => loadSearchArchived(providerId))
  // serverResults: null = not yet fetched / cleared; array = server response
  const [serverResults,  setServerResults]  = useState(null)
  const searchInputRef = useRef(null)
  const searchTimerRef = useRef(null)

  useEffect(() => {
    setSearchQuery('')
    setServerResults(null)
    setSearchArchived(loadSearchArchived(providerId))
    setShowHeadless(loadShowHeadless(providerId))
  }, [providerId])

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
          `${providerApiPath(providerId, 'sessions/search')}?q=${encodeURIComponent(searchQuery)}&archived=${searchArchived ? 1 : 0}`
        )
        if (res.ok) setServerResults(await res.json())
      } catch { /* ignore — client filter still showing */ }
    }, 200)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery, searchArchived, providerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // What to display: server results take priority; fall back to client filter while in flight
  const displayResults = searchQuery.trim()
    ? (serverResults ?? clientFiltered ?? [])
    : null

  const handleSearchArchivedChange = (v) => {
    setSearchArchived(v)
    saveSearchArchived(providerId, v)
  }

  const clearSearch = () => {
    setSearchQuery('')
    setServerResults(null)
  }

  // Close repo-add dropdown on outside click
  useEffect(() => {
    if (!addOpen) return
    const handler = (e) => {
      if (addRef.current?.contains(e.target)) return
      if (addDropRef.current?.contains(e.target)) return
      setAddOpen(false)
      setDropdownSearch('')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addOpen])

  const commitCold = useCallback(() => {
    const n = parseInt(coldInput, 10)
    if (!isNaN(n) && n > 0) onSetColdDays(n)
    else setColdInput(String(coldDays))
    setEditingCold(false)
  }, [coldInput, coldDays, onSetColdDays])

  // Close cold-days editor on outside click
  useEffect(() => {
    if (!editingCold) return
    const handler = (e) => {
      if (coldRef.current && !coldRef.current.contains(e.target)) commitCold()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editingCold, commitCold])

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

  // Compute portal position for the repo-add dropdown (tracks scroll + resize)
  const [addDropdownStyle, setAddDropdownStyle] = useState({})
  useEffect(() => {
    if (!addOpen || !addRef.current) {
      setAddDropdownStyle({})
      return
    }
    const reposition = () => {
      const rect = addRef.current.getBoundingClientRect()
      setAddDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
      })
    }
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [addOpen])

  // Round to 60s granularity — the hot/cold boundary is measured in days,
  // so per-second precision just busts the useMemo cache on every render.
  const nowSec = Math.floor(Date.now() / 60000) * 60
  const coldSec = coldDays * 86400

  // Headless sessions are independent of the repo filter — compute them
  // unconditionally so the headless toggle/section appear on the very first
  // WS push, before the repo-filter auto-init fires.
  const headless = useMemo(() => sessions.filter(isHeadless), [sessions])

  // Filter by active repos + question toggle.
  // Pending sessions (synthetic cards for not-yet-in-DB sessions) always pass
  // through — the user just created them, so hiding behind a filter is confusing.
  const filtered = useMemo(() => {
    if (!repoFilter) return []
    const isPending = s => s.id.startsWith('pending-')
    const interactive = sessions.filter(s => !isHeadless(s))
    let list = interactive.filter(s => isPending(s) || activeRepos.has(s.project))
    if (filterNeedsYou) list = list.filter(s => isPending(s) || s.status === 'question')
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

  // Headless sessions always sort by recency (no question/active priority — they
  // don't follow that lifecycle).
  const sortedHeadless = useMemo(
    () => [...headless].sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    [headless]
  )

  const needsYouCount = sessions.filter(s => s.status === 'question').length

  // Whether the archived option row should be visible
  const showSearchOption = searchFocused || !!searchQuery

  // ── Flyout tooltip for collapsed mode ──────────────────────────────────────
  const [tooltip, setTooltip] = useState(null)

  const showTooltip = useCallback((session, e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const headless = isHeadless(session)
    setTooltip({
      title: headless ? displayTitle(session) : session.title,
      project: session.project,
      status: session.status,
      headless,
      time: session.lastActivityAgo,
      top: rect.top,
      left: rect.right + 8,
    })
  }, [])

  const hideTooltip = useCallback(() => setTooltip(null), [])

  // ── Collapsed sidebar render ───────────────────────────────────────────────
  if (collapsed) {
    // Use filtered list (respects repo filter), combine hot + cold + headless (if shown)
    const allFiltered = [...hot, ...cold, ...(showHeadless ? sortedHeadless : [])]
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
          <NewSessionFAB providerId={providerId} providerLabel={providerLabel} onCreateSession={onCreateSession} />
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
            <span className={`status-badge ${tooltip.headless ? 'headless' : tooltip.status}`}>
              {tooltip.headless
                ? `${HEADLESS_ICON} headless`
                : `${STATUS_ICON[tooltip.status] ?? '·'} ${STATUS_LABEL[tooltip.status] ?? tooltip.status}`}
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
            Run <code>{providerCommand}</code> to start an agent.
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
        <NewSessionFAB providerId={providerId} providerLabel={providerLabel} onCreateSession={onCreateSession} />
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

        {/* Headless show/hide toggle — only meaningful when at least one
            headless session exists. Dimmed while search is active. */}
        {sortedHeadless.length > 0 && (
          <button
            className={`headless-toggle-btn ${showHeadless ? 'active' : ''}`}
            onClick={toggleShowHeadless}
            title={showHeadless
              ? `Hide ${sortedHeadless.length} headless session${sortedHeadless.length === 1 ? '' : 's'}`
              : `Show ${sortedHeadless.length} headless session${sortedHeadless.length === 1 ? '' : 's'}`}
            style={displayResults ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
          >
            {HEADLESS_ICON} {sortedHeadless.length}
          </button>
        )}

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
              title={`Sessions idle longer than this many days are grouped under 'older'. Inactive tabs older than this also auto-close to keep the tab strip tidy.`}
            />
          ) : (
            <button
              className="cold-days-btn"
              onClick={() => { setColdInput(String(coldDays)); setEditingCold(true) }}
              title={`Sessions idle > ${coldDays}d are grouped under 'older'. Inactive tabs older than ${coldDays}d auto-close (active tab is always kept). Click to change.`}
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
                isArchived={!!session.archived}
                onClick={() => session.archived
                  ? onPreview(session.id)
                  : onSelect(session.id)
                }
                onPreview={onPreview}
                onRename={onRename}
                onArchive={onRemove}
                onRestore={onRestore}
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
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleRepo(repo)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRepo(repo) } }}
                      title={state === 'active'
                        ? `Disable ${repo} (hide sessions)`
                        : `Enable ${repo} (show sessions)`}
                    >
                      {repo} <span className="repo-chip-count">({repoSessionCounts[repo] || 0})</span>
                    </span>
                    <span
                      className="repo-chip-x"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); removeRepo(repo) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); removeRepo(repo) } }}
                      title={`Remove ${repo} filter`}
                    >×</span>
                  </span>
                )
              })}
              {/* "All" toggle — single button. When some repos are hidden,
                  click bulk-adds them; when every repo is already a chip,
                  click clears them all.  Saves the user from clicking "+"
                  repeatedly when they have many repos. */}
              {allRepos.length > 1 && (() => {
                const hasHidden = sortedHiddenRepos.length > 0
                return (
                  <button
                    className={`repo-chip repo-chip-all${hasHidden ? '' : ' repo-chip-all-clear'}`}
                    onClick={hasHidden ? addAllRepos : clearAllRepos}
                    title={hasHidden
                      ? `Add all ${sortedHiddenRepos.length} remaining repo${sortedHiddenRepos.length === 1 ? '' : 's'}`
                      : 'Clear all repo filters'}
                  >
                    {hasHidden ? `All +${sortedHiddenRepos.length}` : 'Clear'}
                  </button>
                )
              })()}
              {sortedHiddenRepos.length > 0 && (
                <div className="repo-add-wrap" ref={addRef}>
                  <button className="repo-chip repo-chip-add" onClick={() => setAddOpen(v => !v)} title="Add a project">+</button>
                  {addOpen && createPortal(
                    <div className="repo-add-dropdown repo-add-dropdown-portal" ref={addDropRef} style={addDropdownStyle}>
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
                    </div>,
                    document.body
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Sections: hot → headless (optional) → older (optional) ──
              Driven from a single data structure so the AgentCard map
              isn't duplicated three times. */}
          {(() => {
            const sections = [
              { key: 'hot', items: hot, isOld: false, divider: null },
              ...(showHeadless && sortedHeadless.length > 0 ? [{
                key: 'headless',
                items: sortedHeadless,
                isOld: false,
                divider: (
                  <div className="sidebar-headless-divider">
                    <span>{HEADLESS_ICON} headless · {sortedHeadless.length}</span>
                  </div>
                ),
              }] : []),
              ...(cold.length > 0 ? [{
                key: 'cold',
                items: cold,
                isOld: true,
                divider: <div className="sidebar-older-divider"><span>older</span></div>,
              }] : []),
            ]
            const hasAnyVisible = sections.some(s => s.items.length > 0)
            if (!hasAnyVisible) {
              return (
                <div className="sidebar-empty" style={{ padding: '16px' }}>
                  <div className="sidebar-empty-text">No sessions match the current filter.</div>
                </div>
              )
            }
            return sections.map(section => (
              <Fragment key={section.key}>
                {section.divider}
                {section.items.map(s => (
                  <AgentCard
                    key={s.id}
                    session={s}
                    isActive={s.id === selectedId}
                    isPreview={s.id === previewId}
                    isOld={section.isOld}
                    onClick={() => onSelect(s.id)}
                    onPreview={onPreview}
                    onRename={onRename}
                    onArchive={onRemove}
                  />
                ))}
              </Fragment>
            ))
          })()}
        </>
      )}

      {/* ── Archive drawer + collapse toggle ────────────────────────── */}
      <div className="sidebar-archive-row">
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >‹</button>
        <ArchiveDrawer providerId={providerId} onRestore={onRestore} />
      </div>

      {/* ── Floating new session button ──────────────────────────── */}
      <NewSessionFAB providerId={providerId} providerLabel={providerLabel} onCreateSession={onCreateSession} />
    </aside>
  )
}

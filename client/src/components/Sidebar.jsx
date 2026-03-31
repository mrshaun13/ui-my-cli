/**
 * Sidebar — left panel listing all Devin sessions.
 *
 * Features:
 *  - Repo filter pills (persist to localStorage)
 *  - Auto-grouping: sessions idle > coldDays days sink under an "── older ──" divider
 *  - coldDays threshold is user-configurable (gear icon → inline input, persists to localStorage)
 *  - One-click archive on old+idle cards (no confirm needed — reversible)
 *  - Archive drawer at bottom: "N archived" link → expands to show hidden sessions with Restore
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import AgentCard from './AgentCard.jsx'

const STORAGE_REPOS  = 'devin-dash:visible-repos'
const STORAGE_COLD   = 'devin-dash:cold-days'
const DEFAULT_COLD   = 3

function loadSavedRepos() {
  try {
    const raw = localStorage.getItem(STORAGE_REPOS)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return null
}

function saveRepos(set) {
  try { localStorage.setItem(STORAGE_REPOS, JSON.stringify([...set])) } catch { /* ignore */ }
}

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

  const count = sessions?.length ?? '…'

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

export default function Sidebar({ sessions, selectedId, previewId, onSelect, onPreview, onRename, onRemove, onRestore, filterNeedsYou, onToggleFilter, onCreateSession }) {
  const allRepos = useMemo(() => {
    return [...new Set(sessions.map(s => s.project).filter(Boolean))].sort()
  }, [sessions])

  // Count all active (non-archived) sessions per repo — used by repo pills
  const repoSessionCounts = useMemo(() => {
    const counts = {}
    for (const s of sessions) {
      counts[s.project] = (counts[s.project] || 0) + 1
    }
    return counts
  }, [sessions])

  const [visibleRepos, setVisibleRepos] = useState(() => loadSavedRepos())
  const [addOpen, setAddOpen]           = useState(false)
  const [coldDays, setColdDays]         = useState(loadColdDays)
  const [editingCold, setEditingCold]   = useState(false)
  const [coldInput, setColdInput]       = useState(String(coldDays))
  const addRef  = useRef(null)
  const coldRef = useRef(null)

  // Resolve initial repo selection from first session load
  useEffect(() => {
    if (visibleRepos !== null || sessions.length === 0) return
    const mostRecent = sessions[0]?.project
    if (mostRecent) {
      const initial = new Set([mostRecent])
      setVisibleRepos(initial)
      saveRepos(initial)
    }
  }, [sessions, visibleRepos])

  // Close repo-add dropdown on outside click
  useEffect(() => {
    if (!addOpen) return
    const handler = (e) => {
      if (addRef.current && !addRef.current.contains(e.target)) setAddOpen(false)
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

  const removeRepo = (repo) => {
    setVisibleRepos(prev => {
      const next = new Set(prev); next.delete(repo); saveRepos(next); return next
    })
  }
  const addRepo = (repo) => {
    setVisibleRepos(prev => {
      const next = new Set(prev); next.add(repo); saveRepos(next); return next
    })
    setAddOpen(false)
  }

  const commitCold = () => {
    const n = parseInt(coldInput, 10)
    if (!isNaN(n) && n > 0) { setColdDays(n); saveColdDays(n) }
    else setColdInput(String(coldDays))
    setEditingCold(false)
  }

  const hiddenRepos = useMemo(
    () => allRepos.filter(r => !visibleRepos?.has(r)),
    [allRepos, visibleRepos]
  )

  // Round to 60s granularity — the hot/cold boundary is measured in days,
  // so per-second precision just busts the useMemo cache on every render.
  const nowSec = Math.floor(Date.now() / 60000) * 60
  const coldSec = coldDays * 86400

  // Filter by visible repos + question toggle
  const filtered = useMemo(() => {
    if (!visibleRepos) return []
    let list = sessions.filter(s => visibleRepos.has(s.project))
    if (filterNeedsYou) list = list.filter(s => s.status === 'question')
    return list
  }, [sessions, visibleRepos, filterNeedsYou])

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
        <NewSessionFAB onCreateSession={onCreateSession} />
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="sidebar-section-header">
        <span>Sessions <span className="sidebar-count">({sessions.length})</span></span>
        {needsYouCount > 0 && (
          <button
            className={`filter-btn ${filterNeedsYou ? 'active' : ''}`}
            onClick={onToggleFilter}
            title="Show only sessions waiting for your input"
          >
            ⚡ {needsYouCount}
          </button>
        )}
        {/* Cold-days threshold control */}
        <div className="cold-days-wrap" ref={coldRef}>
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

      {/* ── Repo filter pills ────────────────────────────────────── */}
      {allRepos.length > 1 && visibleRepos && (
        <div className="sidebar-repo-filters">
          {[...visibleRepos].filter(r => allRepos.includes(r)).map(repo => (
            <button key={repo} className="repo-chip on" onClick={() => removeRepo(repo)} title={`Hide ${repo}`}>
              {repo} <span className="repo-chip-count">({repoSessionCounts[repo] || 0})</span><span className="repo-chip-x">×</span>
            </button>
          ))}
          {hiddenRepos.length > 0 && (
            <div className="repo-add-wrap" ref={addRef}>
              <button className="repo-chip repo-chip-add" onClick={() => setAddOpen(v => !v)} title="Add a project">+</button>
              {addOpen && (
                <div className="repo-add-dropdown">
                  {hiddenRepos.map(repo => (
                    <button key={repo} className="repo-add-option" onClick={() => addRepo(repo)}>
                      {repo} <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>({repoSessionCounts[repo] || 0})</span>
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

      {/* ── Archive drawer ───────────────────────────────────────── */}
      <ArchiveDrawer onRestore={onRestore} />

      {/* ── Floating new session button ──────────────────────────── */}
      <NewSessionFAB onCreateSession={onCreateSession} />
    </aside>
  )
}

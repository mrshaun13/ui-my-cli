/**
 * App — root component. Owns selected session state and orchestrates all panels.
 *
 * Layout (CSS grid via .app-shell):
 *   ┌──────────────────────────────────────┐
 *   │  TopBar (logo, status, filter)       │
 *   ├───────────┬──────────────────────────┤
 *   │  Sidebar  │  Terminal (main area)    │
 *   │           ├──────────────────────────┤
 *   │           │  ControlBar              │
 *   └───────────┴──────────────────────────┘
 */

import { useState, useCallback, useEffect } from 'react'
import { useStatusFeed } from './hooks/useStatusFeed.js'
import Sidebar from './components/Sidebar.jsx'
import Terminal from './components/Terminal.jsx'
import ControlBar from './components/ControlBar.jsx'

export default function App() {
  const { sessions, connected, error } = useStatusFeed()
  const [selectedId, setSelectedId] = useState(null)
  const [filterNeedsYou, setFilterNeedsYou] = useState(false)
  const [ptyActive, setPtyActive] = useState(false)

  // Auto-select first "needs_you" session if nothing selected
  useEffect(() => {
    if (selectedId || sessions.length === 0) return
    const urgent = sessions.find(s => s.status === 'needs_you')
    setSelectedId((urgent || sessions[0])?.id || null)
  }, [sessions, selectedId])

  const selectedSession = sessions.find(s => s.id === selectedId) || null

  const handleRename = useCallback(async (id, alias) => {
    await fetch(`/api/sessions/${id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias }),
    })
    // No local state update needed — status feed will push the refresh within 3s
  }, [])

  const handleKillPty = useCallback(async (id) => {
    await fetch(`/api/sessions/${id}/kill-pty`, { method: 'POST' })
    setPtyActive(false)
  }, [])

  const handleSelect = useCallback((id) => {
    setSelectedId(id)
    setPtyActive(true)
  }, [])

  const needsYouCount = sessions.filter(s => s.status === 'needs_you').length

  return (
    <div className="app-shell">
      {/* ── Top Bar ─────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-logo">
          <div className="topbar-dot" />
          Devin <span className="accent">Dashboard</span>
        </div>

        <div className="topbar-divider" />

        <div className="topbar-meta">
          {connected
            ? <><span>{sessions.length}</span> sessions</>
            : 'connecting…'
          }
        </div>

        {needsYouCount > 0 && (
          <>
            <div className="topbar-divider" />
            <div className="topbar-meta">
              <span style={{ color: 'var(--yellow)' }}>⚡ {needsYouCount}</span> waiting for you
            </div>
          </>
        )}

        <div className="topbar-filter">
          <button
            className={`filter-btn ${filterNeedsYou ? 'active' : ''}`}
            onClick={() => setFilterNeedsYou(v => !v)}
            title="Show only sessions that need your attention"
          >
            {filterNeedsYou ? '⚡ Waiting only' : 'All sessions'}
          </button>
        </div>
      </header>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <Sidebar
        sessions={sessions}
        selectedId={selectedId}
        onSelect={handleSelect}
        onRename={handleRename}
        filterNeedsYou={filterNeedsYou}
        onToggleFilter={() => setFilterNeedsYou(v => !v)}
      />

      {/* ── Main Area ───────────────────────────────────────────────── */}
      <main className="main-area">
        {error && (
          <div className="error-banner">
            <span>⚠</span> {error}
          </div>
        )}

        {selectedId ? (
          /*
           * Key on selectedId forces a full Terminal remount when switching sessions.
           * This cleanly tears down the old WebSocket + xterm instance and starts fresh.
           */
          <Terminal key={selectedId} sessionId={selectedId} />
        ) : (
          <div className="main-empty">
            <div className="main-empty-glyph">D/</div>
            <div className="main-empty-label">Select an agent from the sidebar</div>
          </div>
        )}
      </main>

      {/* ── Control Bar ─────────────────────────────────────────────── */}
      <ControlBar
        session={selectedSession}
        ptyActive={ptyActive}
        onKillPty={handleKillPty}
        onRename={handleRename}
      />
    </div>
  )
}

import { useState, useCallback, useEffect, useRef } from 'react'
import { useStatusFeed } from './hooks/useStatusFeed.js'
import Sidebar from './components/Sidebar.jsx'
import Terminal from './components/Terminal.jsx'
import ControlBar from './components/ControlBar.jsx'
import DashboardSplash from './components/DashboardSplash.jsx'
import SessionPreview from './components/SessionPreview.jsx'

// Fetch just the env config fields (MCP servers, skills, plugins) for the topbar.
// Runs once on mount — these are global config, not session-specific.
function useEnv() {
  const [env, setEnv] = useState(null)
  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => setEnv({ mcpServers: d.mcpServers || [], skills: d.skills || [], plugins: d.plugins || [] }))
      .catch(() => {})
  }, [])
  return env
}

function EnvChips({ mcpServers, skills, plugins }) {
  return (
    <div className="topbar-env">
      {mcpServers.length > 0 && (
        <div className="topbar-env-group">
          <span className="topbar-env-label">MCP</span>
          <div className="topbar-env-chips">
            {mcpServers.map(s => (
              <span key={s.name} className="topbar-chip topbar-chip-mcp" title={s.url || s.type}>{s.name}</span>
            ))}
          </div>
        </div>
      )}
      {skills.length > 0 && (
        <div className="topbar-env-group">
          <span className="topbar-env-label">skills</span>
          <div className="topbar-env-chips">
            {skills.map(s => (
              <span key={s.name} className="topbar-chip topbar-chip-skill" title={s.description || s.name}>/{s.name}</span>
            ))}
          </div>
        </div>
      )}
      {plugins.length > 0 && (
        <div className="topbar-env-group">
          <span className="topbar-env-label">plugins</span>
          <div className="topbar-env-chips">
            {plugins.map(p => (
              <span key={p.name}
                className={`topbar-chip ${p.missing ? 'topbar-chip-missing' : 'topbar-chip-plugin'}`}
                title={p.description || p.dir}
              >{p.name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Prompt strip — pinned first user prompt for the active session ───────────

function PromptStrip({ prompt }) {
  const [expanded, setExpanded] = useState(false)
  const prevPromptRef = useRef(prompt)

  // Collapse back to single-line whenever the session changes (new prompt text)
  useEffect(() => {
    if (prevPromptRef.current !== prompt) {
      setExpanded(false)
      prevPromptRef.current = prompt
    }
  }, [prompt])

  if (!prompt) return null

  const isLong = prompt.length > 120

  return (
    <div
      className={`prompt-strip${expanded ? ' expanded' : ''}`}
      onClick={isLong ? () => setExpanded(v => !v) : undefined}
      title={isLong && !expanded ? 'Click to expand' : undefined}
      style={{ cursor: isLong ? 'pointer' : 'default' }}
    >
      <span className="prompt-strip-label">prompt</span>
      <span className="prompt-strip-text">{prompt}</span>
      {isLong && (
        <span className="prompt-strip-toggle">{expanded ? '▼' : '▲'}</span>
      )}
    </div>
  )
}

export default function App() {
  const { sessions, connected, error, latestPrompt, viewedAt, markViewed, rekeyMap } = useStatusFeed()
  const [selectedId, setSelectedId] = useState(null)
  const [previewId,  setPreviewId]  = useState(null)
  const [filterNeedsYou, setFilterNeedsYou] = useState(false)
  const env = useEnv()

  const goHome = () => { setSelectedId(null); setPreviewId(null) }

  // If the selected/previewed session disappears, go back to splash.
  // Skip this check for pending sessions (not yet in the DB).
  useEffect(() => {
    if (sessions.length === 0) return
    if (selectedId && !selectedId.startsWith('pending-') && !sessions.find(s => s.id === selectedId)) setSelectedId(null)
    if (previewId  && !sessions.find(s => s.id === previewId))  setPreviewId(null)
  }, [sessions, selectedId, previewId])

  // When the server re-keys a pending session to its real ID, swap selectedId
  // so the sidebar highlights the correct card and the Terminal remounts with
  // the real session ID (which the PTY is now keyed under).
  useEffect(() => {
    if (!selectedId || !selectedId.startsWith('pending-')) return
    const realId = rekeyMap[selectedId]
    if (realId) setSelectedId(realId)
  }, [selectedId, rekeyMap])

  const selectedSession = sessions.find(s => s.id === selectedId) || null

  const handleRename = useCallback(async (id, title) => {
    await fetch(`/api/sessions/${id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
  }, [])

  const handleRemove = useCallback(async (id) => {
    if (selectedId === id) setSelectedId(null)
    if (previewId  === id) setPreviewId(null)
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
  }, [selectedId, previewId])

  const handleRestore = useCallback(async (id) => {
    await fetch(`/api/sessions/${id}/restore`, { method: 'POST' })
  }, [])

  const handleCreateSession = useCallback(async (workingDir) => {
    const res = await fetch('/api/sessions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingDir }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to create session')
    }
    const { tempKey } = await res.json()
    // Use the temp key as the selectedId — Terminal.jsx will connect to
    // /ws/terminal/<tempKey> where the PTY is already waiting.
    // Once the user types their first prompt, the Devin CLI writes a session
    // record. The server re-keys the PTY in the background, and the session
    // appears in the sidebar via the 3s status poll.
    setSelectedId(tempKey)
    setPreviewId(null)
  }, [])

  const handleSelect = useCallback((id) => {
    setSelectedId(id)
    setPreviewId(null)   // close preview when going live
    markViewed && markViewed(id)
  }, [markViewed])

  const handlePreview = useCallback((id) => {
    setPreviewId(id)
    setSelectedId(null)  // close live terminal when previewing
  }, [])

  // Resume from preview → open live terminal
  const handleResume = useCallback((id) => {
    setPreviewId(null)
    setSelectedId(id)
    markViewed && markViewed(id)
  }, [markViewed])

  const needsYouCount = sessions.filter(s => s.status === 'question').length

  // What to show in the main area
  const mainView = selectedId ? 'terminal' : previewId ? 'preview' : 'splash'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo" onClick={goHome} style={{ cursor: 'pointer' }} title="Go to dashboard">
          <div className="topbar-dot" />
          Devin <span className="accent">Dashboard</span>
        </div>

        <div className="topbar-divider" />

        {selectedSession
          ? null
          : env && (env.mcpServers.length > 0 || env.skills.length > 0 || env.plugins.length > 0) && (
              <EnvChips mcpServers={env.mcpServers} skills={env.skills} plugins={env.plugins} />
            )
        }

        {needsYouCount > 0 && (
          <div className="topbar-meta" style={{ marginLeft: 'auto' }}>
            <span style={{ color: 'var(--yellow)' }}>⚡ {needsYouCount}</span> waiting
          </div>
        )}
      </header>

      <Sidebar
        sessions={sessions}
        selectedId={selectedId}
        previewId={previewId}
        onSelect={handleSelect}
        onPreview={handlePreview}
        onRename={handleRename}
        onRemove={handleRemove}
        onRestore={handleRestore}
        onCreateSession={handleCreateSession}
        filterNeedsYou={filterNeedsYou}
        onToggleFilter={() => setFilterNeedsYou(v => !v)}
      />

      <main className="main-area">
        {error && (
          <div className="error-banner"><span>⚠</span> {error}</div>
        )}

        {mainView === 'terminal' && (
          <Terminal key={selectedId} sessionId={selectedId} />
        )}
        {mainView === 'preview' && (
          <SessionPreview
            sessionId={previewId}
            onResume={handleResume}
            onArchive={handleRemove}
            onRename={handleRename}
          />
        )}
        {mainView === 'splash' && (
          <DashboardSplash sessions={sessions} connected={connected} />
        )}

        {selectedSession && (
          <PromptStrip prompt={selectedSession.lastUserPrompt} />
        )}
      </main>

      <ControlBar
        session={selectedSession}
        onRename={handleRename}
        onRemove={handleRemove}
      />
    </div>
  )
}

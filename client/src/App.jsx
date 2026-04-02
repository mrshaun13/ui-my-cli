import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useStatusFeed } from './hooks/useStatusFeed.js'
import Sidebar from './components/Sidebar.jsx'
import Terminal from './components/Terminal.jsx'
import ControlBar from './components/ControlBar.jsx'
import DashboardSplash from './components/DashboardSplash.jsx'
import SessionPreview from './components/SessionPreview.jsx'
// ContextPieChart is rendered inside ControlBar (not imported here)

/**
 * Cross-platform project name extraction.
 * Handles both Unix (/) and Windows (\) path separators so the
 * synthetic sidebar card shows the correct project name regardless
 * of the server's OS.
 */
function projectFromDir(dir) {
  if (!dir) return 'unknown'
  // Normalise backslashes → forward slashes, strip trailing slash
  const norm = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  return norm.split('/').pop() || 'unknown'
}

// ── Sidebar collapsed state (persisted to localStorage) ──────────────────────
const STORAGE_COLLAPSED = 'devin-dash:sidebar-collapsed'
function loadCollapsed() {
  try { return localStorage.getItem(STORAGE_COLLAPSED) === 'true' } catch { return false }
}
function saveCollapsed(v) {
  try { localStorage.setItem(STORAGE_COLLAPSED, String(v)) } catch {}
}

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
  const { sessions, connected, error, latestPrompt, rekeyMap } = useStatusFeed()
  const [selectedId, setSelectedId] = useState(null)
  const [previewId,  setPreviewId]  = useState(null)
  const [filterNeedsYou, setFilterNeedsYou] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed)
  const env = useEnv()

  // Track metadata for pending sessions not yet in the DB.
  // Keys are temp keys (e.g. "pending-123-abc"), values are { workingDir, project, createdAt }.
  const [pendingMeta, setPendingMeta] = useState({})

  // Stable Terminal key — set once when a session is first opened, never changed
  // on rekey. This prevents React from remounting the Terminal (and losing
  // scrollback + WebSocket) when selectedId swaps from pending-xxx to real UUID.
  const terminalKeyRef = useRef(null)

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      saveCollapsed(next)
      return next
    })
  }, [])

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

  const handleRename = useCallback(async (id, title) => {
    await fetch(`/api/sessions/${id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
  }, [])

  const handleRemove = useCallback(async (id) => {
    const prevSelected = selectedId
    const prevPreview = previewId
    if (selectedId === id) setSelectedId(null)
    if (previewId  === id) setPreviewId(null)
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Archive failed')
    } catch {
      // Rollback UI state on failure
      if (prevSelected === id) setSelectedId(prevSelected)
      if (prevPreview === id)  setPreviewId(prevPreview)
    }
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
    // Track metadata so we can inject a synthetic sidebar card immediately
    const nowSec = Math.floor(Date.now() / 1000)
    setPendingMeta(prev => ({
      ...prev,
      [tempKey]: { workingDir, project: projectFromDir(workingDir), createdAt: nowSec },
    }))
    // Set the stable Terminal key — this won't change on rekey
    terminalKeyRef.current = tempKey
    setSelectedId(tempKey)
    setPreviewId(null)
  }, [])

  const handleSelect = useCallback((id) => {
    if (id === selectedId) return   // already viewing — no-op
    terminalKeyRef.current = id     // stable key for this session
    setSelectedId(id)
    setPreviewId(null)   // close preview when going live
  }, [selectedId])

  const handlePreview = useCallback((id) => {
    if (id === previewId) {
      // Click-to-toggle: already previewing → switch to terminal
      terminalKeyRef.current = id
      setSelectedId(id)
      setPreviewId(null)
    } else {
      setPreviewId(id)
      setSelectedId(null)  // close live terminal when previewing
    }
  }, [previewId])

  // Resume from preview → open live terminal
  const handleResume = useCallback((id) => {
    setPreviewId(null)
    terminalKeyRef.current = id
    setSelectedId(id)
  }, [])

  const needsYouCount = sessions.filter(s => s.status === 'question').length

  // ── Synthetic sidebar entries for pending sessions ─────────────────────────
  // Injects a placeholder card so the sidebar shows the new session immediately
  // (before the Devin CLI writes a DB record).  Three detection methods prevent
  // duplicate cards when the real session arrives before the rekey poll fires.
  const sidebarSessions = useMemo(() => {
    const pendingKeys = Object.keys(pendingMeta)
    if (pendingKeys.length === 0) return sessions

    const dbIds = new Set(sessions.map(s => s.id))

    const synthetics = pendingKeys
      .filter(key => {
        const meta = pendingMeta[key]
        // Method 1: re-keyed and real session is in DB
        const realId = rekeyMap[key]
        if (realId && dbIds.has(realId)) return false
        // Method 2: pending key itself appeared in DB (unusual, but safe)
        if (dbIds.has(key)) return false
        // Method 3: WAL watcher pushed the real session before rekey poll —
        // match by workingDir + creation time (within 30s window)
        const hasDbMatch = sessions.some(s =>
          s.workingDir === meta.workingDir &&
          Math.abs(s.createdAt - meta.createdAt) < 30
        )
        if (hasDbMatch) return false
        return true
      })
      .map(key => ({
        id: rekeyMap[key] || key,
        title: 'New Session',
        workingDir: pendingMeta[key].workingDir,
        project: pendingMeta[key].project,
        model: '',
        status: 'active',
        snippet: 'Starting…',
        firstUserPrompt: null,
        lastUserPrompt: null,
        hasSubagents: false,
        lastActivityAt: pendingMeta[key].createdAt,
        lastActivityAgo: 'just now',
        createdAt: pendingMeta[key].createdAt,
      }))

    return synthetics.length > 0 ? [...synthetics, ...sessions] : sessions
  }, [sessions, pendingMeta, rekeyMap])

  const selectedSession = sidebarSessions.find(s => s.id === selectedId) || null

  // What to show in the main area
  const mainView = selectedId ? 'terminal' : previewId ? 'preview' : 'splash'

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <header className="topbar">
        <div className="topbar-logo" onClick={goHome} style={{ cursor: 'pointer' }} title="Go to dashboard">
          <div className="topbar-dot" />
          Devin <span className="accent">Dashboard</span>
        </div>

        <div className="topbar-divider" />

        {env && (env.mcpServers.length > 0 || env.skills.length > 0 || env.plugins.length > 0) && (
          <EnvChips mcpServers={env.mcpServers} skills={env.skills} plugins={env.plugins} />
        )}

        <div className="topbar-right">
          {needsYouCount > 0 && (
            <div className="topbar-meta">
              <span style={{ color: 'var(--yellow)' }}>⚡ {needsYouCount}</span> waiting
            </div>
          )}
        </div>
      </header>

      <Sidebar
        sessions={sidebarSessions}
        selectedId={selectedId}
        previewId={previewId}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
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
          <Terminal key={terminalKeyRef.current} sessionId={selectedId} />
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
          <DashboardSplash connected={connected} latestPrompt={latestPrompt} onSelectSession={handlePreview} />
        )}

        {selectedSession && (
          <PromptStrip prompt={selectedSession.lastUserPrompt || selectedSession.firstUserPrompt} />
        )}
      </main>

      <ControlBar
        session={selectedSession}
        sessionId={selectedId || previewId}
        onRename={handleRename}
        onRemove={handleRemove}
      />
    </div>
  )
}

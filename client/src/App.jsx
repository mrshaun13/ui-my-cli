import { useState, useCallback, useEffect, useRef, useMemo, useReducer } from 'react'
import { useStatusFeed } from './hooks/useStatusFeed.js'
import Sidebar from './components/Sidebar.jsx'
import Terminal from './components/Terminal.jsx'
import TabBar from './components/TabBar.jsx'
import ControlBar from './components/ControlBar.jsx'
import DashboardSplash from './components/DashboardSplash.jsx'
import SessionPreview from './components/SessionPreview.jsx'
import HeadlessPlaceholder from './components/HeadlessPlaceholder.jsx'
import { isHeadless } from './lib/headless.js'
import { DEFAULT_PROVIDER_ID, providerApiPath, providerStorageKey } from './lib/providers.js'
import { DASHBOARD_STYLES, applyDashboardStyle, loadDashboardStyle, saveDashboardStyle } from './lib/dashboardStyles.js'
import { TEXT_SIZES, applyTextSize, loadTextSize, saveTextSize } from './lib/textSizes.js'
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
const STORAGE_COLLAPSED = 'codex-dash:sidebar-collapsed'
function loadCollapsed() {
  try { return localStorage.getItem(STORAGE_COLLAPSED) === 'true' } catch { return false }
}
function saveCollapsed(v) {
  try { localStorage.setItem(STORAGE_COLLAPSED, String(v)) } catch {}
}

// ── Sidebar width (persisted to localStorage) ────────────────────────────────
// Default is 360px — 20% wider than the previous 300px, since the user routinely
// works with long repo names and many chips.  Clamped to a sane range so a
// runaway drag can't break the layout.
const STORAGE_SIDEBAR_W = 'codex-dash:sidebar-width'
const SIDEBAR_W_DEFAULT = 360
const SIDEBAR_W_MIN     = 240
const SIDEBAR_W_MAX     = 640
function loadSidebarWidth() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_SIDEBAR_W), 10)
    if (!isNaN(v) && v >= SIDEBAR_W_MIN && v <= SIDEBAR_W_MAX) return v
  } catch { /* ignore */ }
  return SIDEBAR_W_DEFAULT
}
function saveSidebarWidth(w) {
  try { localStorage.setItem(STORAGE_SIDEBAR_W, String(w)) } catch {}
}

// ── Cold-days threshold (persisted to localStorage) ──────────────────────────
// Lifted here from Sidebar so it can drive BOTH (a) the sidebar's hot/older
// divider and (b) the tab auto-close effect.  Single source of truth keeps
// the two views consistent without dispatching custom events between them.
const COLD_DEFAULT = 3
function loadColdDays(providerId) {
  try {
    const v = parseInt(localStorage.getItem(providerStorageKey(providerId, 'cold-days')), 10)
    if (!isNaN(v) && v > 0) return v
  } catch { /* ignore */ }
  return COLD_DEFAULT
}
function saveColdDays(providerId, n) {
  try { localStorage.setItem(providerStorageKey(providerId, 'cold-days'), String(n)) } catch {}
}

// ── Tab persistence (localStorage) ───────────────────────────────────────────
function loadStoredTabs(providerId) {
  try {
    const raw = localStorage.getItem(providerStorageKey(providerId, 'open-tabs'))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.tabs)) return parsed
  } catch { /* ignore */ }
  return null
}
function saveStoredTabs(providerId, tabs, activeTabId) {
  try {
    localStorage.setItem(providerStorageKey(providerId, 'open-tabs'), JSON.stringify({ tabs, activeTabId }))
  } catch { /* ignore */ }
}

const STORAGE_PROVIDER = 'agent-dash:selected-provider'
const FALLBACK_PROVIDERS = [
  { id: 'codex', label: 'Codex', command: 'codex', dashboardTitle: 'Codex Dashboard', available: true },
  { id: 'devin', label: 'Devin', command: 'devin', dashboardTitle: 'Devin Dashboard', available: true },
]

function loadSelectedProvider() {
  try { return localStorage.getItem(STORAGE_PROVIDER) || DEFAULT_PROVIDER_ID } catch { return DEFAULT_PROVIDER_ID }
}

function saveSelectedProvider(providerId) {
  try { localStorage.setItem(STORAGE_PROVIDER, providerId) } catch {}
}

// ── Tab state reducer ────────────────────────────────────────────────────────
// Combines tabs[] and activeTabId into one atomic state to avoid
// coordination bugs between multiple useState setters.

function tabReducer(state, action) {
  switch (action.type) {
    case 'open': {
      // Open a session in a tab (or activate existing tab)
      const { id, mode } = action
      const exists = state.tabs.find(t => t.id === id)
      if (exists) {
        return {
          tabs: state.tabs.map(t => t.id === id ? { ...t, mode } : t),
          activeTabId: id,
        }
      }
      // New tab — mountKey is set once and never changes (survives rekey)
      return {
        tabs: [...state.tabs, { id, mode, mountKey: id }],
        activeTabId: id,
      }
    }
    case 'activate': {
      // Click on tab title — activate in terminal mode
      const tab = state.tabs.find(t => t.id === action.id)
      if (!tab) return state
      return {
        tabs: state.tabs.map(t => t.id === action.id ? { ...t, mode: 'terminal' } : t),
        activeTabId: action.id,
      }
    }
    case 'togglePreview': {
      // Click the info icon on a tab — toggle between terminal and preview
      const tab = state.tabs.find(t => t.id === action.id)
      if (!tab) return state
      return {
        tabs: state.tabs.map(t =>
          t.id === action.id
            ? { ...t, mode: t.mode === 'preview' ? 'terminal' : 'preview' }
            : t
        ),
        activeTabId: action.id,
      }
    }
    case 'close': {
      // Close a tab — pick a neighbor if it was active
      const idx = state.tabs.findIndex(t => t.id === action.id)
      if (idx === -1) return state
      const next = state.tabs.filter(t => t.id !== action.id)
      let nextActive = state.activeTabId
      if (state.activeTabId === action.id) {
        if (next.length === 0) {
          nextActive = null
        } else {
          nextActive = next[Math.min(idx, next.length - 1)].id
        }
      }
      return { tabs: next, activeTabId: nextActive }
    }
    case 'rekey': {
      // Pending session got its real UUID — update tab ID, keep mountKey stable
      const { oldId, newId } = action
      if (!state.tabs.some(t => t.id === oldId)) return state
      return {
        tabs: state.tabs.map(t => t.id === oldId ? { ...t, id: newId } : t),
        activeTabId: state.activeTabId === oldId ? newId : state.activeTabId,
      }
    }
    case 'deactivate': {
      // Logo click — go to splash, keep tabs open
      return { ...state, activeTabId: null }
    }
    case 'restore': {
      // Restore from localStorage on initial load
      return { tabs: action.tabs, activeTabId: action.activeTabId }
    }
    case 'reset': {
      return { tabs: [], activeTabId: null }
    }
    default:
      return state
  }
}

function useProviders() {
  const [providers, setProviders] = useState(FALLBACK_PROVIDERS)

  useEffect(() => {
    let cancelled = false
    fetch('/api/providers')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d) && d.length > 0) setProviders(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return providers
}

// Fetch just the env config fields (MCP servers, skills, plugins) for the topbar.
// Provider-scoped because Codex and Devin read different local config roots.
function useEnv(providerId, enabled) {
  const [env, setEnv] = useState(null)
  useEffect(() => {
    setEnv(null)
    if (!enabled) return
    fetch(providerApiPath(providerId, 'stats'))
      .then(r => r.json())
      .then(d => setEnv({ mcpServers: d.mcpServers || [], skills: d.skills || [], plugins: d.plugins || [] }))
      .catch(() => {})
  }, [providerId, enabled])
  return env
}

function ProviderSwitch({ providers, selectedProviderId, onSelect }) {
  return (
    <div className="provider-switch" role="tablist" aria-label="Agent provider">
      {providers.map(provider => (
        <button
          key={provider.id}
          type="button"
          role="tab"
          aria-selected={provider.id === selectedProviderId}
          className={`provider-switch-btn${provider.id === selectedProviderId ? ' active' : ''}${provider.available === false ? ' unavailable' : ''}`}
          onClick={() => onSelect(provider.id)}
          title={provider.available === false ? (provider.error || `${provider.label} is unavailable`) : `${provider.label} dashboard`}
        >
          <span className="provider-switch-dot" style={{ background: provider.accent || 'var(--accent)' }} />
          {provider.label}
        </button>
      ))}
    </div>
  )
}

function StyleSelect({ selectedStyleId, onSelect }) {
  const selectedStyle = DASHBOARD_STYLES.find(style => style.id === selectedStyleId) || DASHBOARD_STYLES[0]

  return (
    <label className="style-select-wrap" title={`${selectedStyle.label} ${selectedStyle.mode} style`}>
      <span className="style-select-label">Style</span>
      <span className="style-select-swatch" style={{ background: selectedStyle.swatch }} aria-hidden="true" />
      <select
        className="style-select"
        value={selectedStyleId}
        onChange={event => onSelect(event.target.value)}
        aria-label="Dashboard style"
      >
        {DASHBOARD_STYLES.map(style => (
          <option key={style.id} value={style.id}>
            {style.label}{style.isDefault ? ' (Default)' : ''} · {style.mode === 'light' ? 'Light' : 'Dark'}
          </option>
        ))}
      </select>
    </label>
  )
}

function TextSizeControl({ selectedTextSizeId, onSelect }) {
  return (
    <div className="text-size-control" role="group" aria-label="Text size">
      <span className="text-size-label">Text</span>
      <div className="text-size-options">
        {TEXT_SIZES.map(size => (
          <button
            key={size.id}
            type="button"
            className={`text-size-btn${size.id === selectedTextSizeId ? ' active' : ''}`}
            aria-pressed={size.id === selectedTextSizeId}
            onClick={() => onSelect(size.id)}
            title={`${size.label} text size`}
          >
            <span className="text-size-full-label">{size.label}</span>
            <span className="text-size-short-label" aria-hidden="true">{size.shortLabel}</span>
          </button>
        ))}
      </div>
    </div>
  )
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
  const providers = useProviders()
  const [styleId, setStyleIdState] = useState(() => {
    const savedStyle = loadDashboardStyle()
    applyDashboardStyle(savedStyle)
    return savedStyle
  })
  const [textSizeId, setTextSizeIdState] = useState(() => {
    const savedTextSize = loadTextSize()
    applyTextSize(savedTextSize)
    return savedTextSize
  })
  const [selectedProviderId, setSelectedProviderIdState] = useState(loadSelectedProvider)
  const selectedProvider = providers.find(p => p.id === selectedProviderId) || providers[0] || FALLBACK_PROVIDERS[0]
  const providerId = selectedProvider?.id || DEFAULT_PROVIDER_ID
  const providerLabel = selectedProvider?.label || providerId
  const providerCommand = selectedProvider?.command || providerId
  const { sessions, connected, error, latestPrompt, rekeyMap, expiredPending } = useStatusFeed(providerId)
  const providerSessionsReady = sessions.length > 0 && sessions.every(s => !s.provider || s.provider === providerId)
  const [filterNeedsYou, setFilterNeedsYou] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const [coldDays, setColdDaysState] = useState(() => loadColdDays(providerId))
  const [nativeLaunchPending, setNativeLaunchPending] = useState(false)
  const [nativeLaunchError, setNativeLaunchError] = useState('')
  const [nativeLaunchCapability, setNativeLaunchCapability] = useState(null)
  const env = useEnv(providerId, providerSessionsReady)

  const setSelectedProviderId = useCallback((nextProviderId) => {
    setSelectedProviderIdState(nextProviderId)
    saveSelectedProvider(nextProviderId)
  }, [])

  const setStyleId = useCallback((nextStyleId) => {
    setStyleIdState(nextStyleId)
    applyDashboardStyle(nextStyleId)
    saveDashboardStyle(nextStyleId)
  }, [])

  const setTextSizeId = useCallback((nextTextSizeId) => {
    setTextSizeIdState(nextTextSizeId)
    applyTextSize(nextTextSizeId)
    saveTextSize(nextTextSizeId)
  }, [])

  const setColdDays = useCallback((n) => {
    setColdDaysState(n)
    saveColdDays(providerId, n)
  }, [providerId])

  // ── Tab state (replaces selectedId / previewId) ────────────────────────────
  const [tabState, dispatch] = useReducer(tabReducer, { tabs: [], activeTabId: null })
  const { tabs, activeTabId } = tabState

  // Track whether we've restored tabs from localStorage
  const tabsRestoredRef = useRef(false)

  // Track metadata for pending sessions not yet in the DB.
  // Keys are temp keys (e.g. "pending-123-abc"), values are { workingDir, project, createdAt }.
  const [pendingMeta, setPendingMeta] = useState({})

  useEffect(() => {
    setColdDaysState(loadColdDays(providerId))
    setFilterNeedsYou(false)
    setPendingMeta({})
    tabsRestoredRef.current = false
    dispatch({ type: 'reset' })
  }, [providerId])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      saveCollapsed(next)
      return next
    })
  }, [])

  // Mouse-driven sidebar resize.  We attach move/up listeners on the
  // document so the drag survives even when the cursor leaves the handle.
  // Using mouse* (vs pointer*) for cross-browser/automation reliability.
  const handleSidebarDragStart = useCallback((e) => {
    if (sidebarCollapsed) return
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth

    const onMove = (ev) => {
      const next = Math.max(SIDEBAR_W_MIN, Math.min(SIDEBAR_W_MAX, startW + (ev.clientX - startX)))
      setSidebarWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('sidebar-resizing')
    }
    document.body.classList.add('sidebar-resizing')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp, { once: true })
  }, [sidebarCollapsed, sidebarWidth])

  // Persist width whenever it settles (debounced via the trailing edge).
  useEffect(() => {
    const t = setTimeout(() => saveSidebarWidth(sidebarWidth), 250)
    return () => clearTimeout(t)
  }, [sidebarWidth])

  const goHome = useCallback(() => dispatch({ type: 'deactivate' }), [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/native/launch/status')
      .then(response => response.ok ? response.json() : null)
      .then(capability => {
        if (!cancelled) setNativeLaunchCapability(capability)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handleLaunchNative = useCallback(async () => {
    setNativeLaunchPending(true)
    setNativeLaunchError('')
    try {
      const response = await fetch('/api/native/launch', { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'The operating system could not launch Codex Native.')
      }
    } catch (error) {
      setNativeLaunchError(error.message)
    } finally {
      setNativeLaunchPending(false)
    }
  }, [])

  // ── Persist tabs to localStorage on every change ───────────────────────────
  useEffect(() => {
    // Don't overwrite stored tabs before we've had a chance to restore them
    if (!tabsRestoredRef.current) return
    saveStoredTabs(providerId, tabs, activeTabId)
  }, [providerId, tabs, activeTabId])

  // ── Restore tabs from localStorage once sessions arrive ────────────────────
  useEffect(() => {
    if (tabsRestoredRef.current || sessions.length === 0) return
    tabsRestoredRef.current = true
    const stored = loadStoredTabs(providerId)
    if (!stored || stored.tabs.length === 0) return
    const sessionsById = new Map(sessions.map(s => [s.id, s]))
    // Drop persisted tabs whose underlying session is older than the cold-days
    // threshold — restoring them would just trigger the auto-close effect on
    // the next tick, causing a brief flicker.  The previously-active tab is
    // exempt: if you closed the browser staring at it, you almost certainly
    // want it back when you reopen.
    const cutoff = Math.floor(Date.now() / 1000) - coldDays * 86400
    const validTabs = stored.tabs
      .filter(t => {
        const s = sessionsById.get(t.id)
        if (!s) return false
        if (t.id === stored.activeTabId) return true
        return (s.lastActivityAt || 0) >= cutoff
      })
      .map(t => ({
        id: t.id,
        mode: t.mode || 'terminal',
        mountKey: t.mountKey || t.id,
      }))
    if (validTabs.length === 0) return
    const activeId = validTabs.find(t => t.id === stored.activeTabId)
      ? stored.activeTabId
      : validTabs[0].id
    dispatch({ type: 'restore', tabs: validTabs, activeTabId: activeId })
  }, [sessions, coldDays, providerId])

  // Mark restored immediately if there will never be sessions
  // (tabsRestoredRef prevents the persist effect from running until we've restored)
  useEffect(() => {
    // If no stored tabs exist, mark as restored immediately so persistence starts
    if (!tabsRestoredRef.current && !loadStoredTabs(providerId)) {
      tabsRestoredRef.current = true
    }
  }, [providerId])

  // If a tabbed session disappears from the live list, close its tab.
  // Skip pending sessions (not yet in the DB).
  useEffect(() => {
    if (sessions.length === 0) return
    const sessionIds = new Set(sessions.map(s => s.id))
    for (const tab of tabs) {
      if (!tab.id.startsWith('pending-') && !sessionIds.has(tab.id)) {
        dispatch({ type: 'close', id: tab.id })
      }
    }
  }, [sessions, tabs])

  // ── Auto-close stale tabs ──────────────────────────────────────────────────
  // Tab strip can grow forever if the user never manually closes anything.
  // Once a tab's underlying session has been idle longer than the cold-days
  // threshold, close it — UNLESS it's the active tab (don't yank focus from
  // the user) or a pending one (just created, not yet in the DB feed).
  // Re-runs on every sessions tick so tabs that go stale during a long
  // browser session get cleaned up incrementally.
  useEffect(() => {
    if (sessions.length === 0 || tabs.length === 0) return
    const cutoff = Math.floor(Date.now() / 1000) - coldDays * 86400
    const sessionsById = new Map(sessions.map(s => [s.id, s]))
    for (const tab of tabs) {
      if (tab.id === activeTabId) continue
      if (tab.id.startsWith('pending-')) continue
      const s = sessionsById.get(tab.id)
      if (!s) continue   // handled by the disappearance effect above
      if ((s.lastActivityAt || 0) < cutoff) {
        dispatch({ type: 'close', id: tab.id })
      }
    }
  }, [sessions, tabs, activeTabId, coldDays])

  // When the server re-keys a pending session to its real ID, update the tab
  // and clean up the pendingMeta entry (the real session is now in the DB feed).
  useEffect(() => {
    for (const [oldId, newId] of Object.entries(rekeyMap)) {
      dispatch({ type: 'rekey', oldId, newId })
      setPendingMeta(prev => {
        if (!prev[oldId]) return prev
        const next = { ...prev }
        delete next[oldId]
        return next
      })
    }
  }, [rekeyMap])

  // When the server reports a pending session's rekey poll expired (session
  // never got a real ID), close the orphaned tab and clean up pendingMeta.
  useEffect(() => {
    if (expiredPending.size === 0) return
    for (const tempKey of expiredPending) {
      dispatch({ type: 'close', id: tempKey })
      setPendingMeta(prev => {
        if (!prev[tempKey]) return prev
        const next = { ...prev }
        delete next[tempKey]
        return next
      })
    }
  }, [expiredPending])

  const handleRename = useCallback(async (id, title) => {
    await fetch(providerApiPath(providerId, `sessions/${id}/rename`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
  }, [providerId])

  const handleRemove = useCallback(async (id) => {
    // Optimistically close the tab
    dispatch({ type: 'close', id })
    try {
      const res = await fetch(providerApiPath(providerId, `sessions/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Archive failed')
    } catch {
      // Session will reappear in next WS push if archive actually failed
    }
  }, [providerId])

  const handleRestore = useCallback(async (id) => {
    await fetch(providerApiPath(providerId, `sessions/${id}/restore`), { method: 'POST' })
  }, [providerId])

  const handleCreateSession = useCallback(async (workingDir) => {
    const res = await fetch(providerApiPath(providerId, 'sessions/create'), {
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
    // Open the pending session in a new tab
    dispatch({ type: 'open', id: tempKey, mode: 'terminal' })
  }, [providerId])

  // ── Sidebar callbacks (routed to tab management) ───────────────────────────

  const handleSelect = useCallback((id) => {
    dispatch({ type: 'open', id, mode: 'terminal' })
  }, [])

  const handlePreview = useCallback((id) => {
    dispatch({ type: 'open', id, mode: 'preview' })
  }, [])

  // Resume from preview → switch tab to terminal mode
  const handleResume = useCallback((id) => {
    dispatch({ type: 'open', id, mode: 'terminal' })
  }, [])

  // ── Tab bar callbacks ──────────────────────────────────────────────────────

  const handleActivateTab = useCallback((id) => {
    dispatch({ type: 'activate', id })
  }, [])

  const handleTogglePreview = useCallback((id) => {
    dispatch({ type: 'togglePreview', id })
  }, [])

  const handleCloseTab = useCallback((id) => {
    dispatch({ type: 'close', id })
  }, [])

  const needsYouCount = sessions.filter(s => s.status === 'question').length

  // ── Synthetic sidebar entries for pending sessions ─────────────────────────
  // Injects a placeholder card so the sidebar shows the new session immediately
  // (before the Codex CLI writes a DB record).  Three detection methods prevent
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

  // ── Derived state ──────────────────────────────────────────────────────────
  const activeTab = tabs.find(t => t.id === activeTabId) || null
  const selectedSession = sidebarSessions.find(s => s.id === activeTabId) || null
  const selectedIsHeadless = selectedSession ? isHeadless(selectedSession) : false

  // For the Sidebar: derive selectedId/previewId from the active tab's mode
  const sidebarSelectedId = (activeTab?.mode === 'terminal') ? activeTabId : null
  const sidebarPreviewId  = (activeTab?.mode === 'preview')  ? activeTabId : null

  // What to show in the main area
  const mainView = activeTabId
    ? (activeTab?.mode || 'terminal')
    : 'splash'

  return (
    <div
      className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
      // Only override --sidebar-w when expanded; collapsed mode has its
      // own 48px rule that we don't want to fight with.
      style={!sidebarCollapsed ? { '--sidebar-w': `${sidebarWidth}px` } : undefined}
    >
      <header className="topbar">
        <div className="topbar-logo" role="button" tabIndex={0} onClick={goHome}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome() } }}
          style={{ cursor: 'pointer' }} title="Go to dashboard">
          <div className="topbar-dot" />
          {providerLabel} <span className="accent">Dashboard</span>
        </div>

        <div className="topbar-divider" />

        <ProviderSwitch
          providers={providers}
          selectedProviderId={providerId}
          onSelect={setSelectedProviderId}
        />

        <div className="topbar-divider" />

        <StyleSelect selectedStyleId={styleId} onSelect={setStyleId} />

        <div className="topbar-divider topbar-divider-after-style" />

        <TextSizeControl selectedTextSizeId={textSizeId} onSelect={setTextSizeId} />

        <div className="topbar-divider topbar-divider-after-text-size" />

        {env && (env.mcpServers.length > 0 || env.skills.length > 0 || env.plugins.length > 0) && (
          <EnvChips mcpServers={env.mcpServers} skills={env.skills} plugins={env.plugins} />
        )}

        <div className="topbar-right">
          {needsYouCount > 0 && (
            <div className="topbar-meta">
              <span style={{ color: 'var(--yellow)' }}>⚡ {needsYouCount}</span> waiting
            </div>
          )}
          {nativeLaunchCapability?.supported && (
            <button
              type="button"
              className="surface-launch-btn"
              onClick={handleLaunchNative}
              disabled={nativeLaunchPending}
              aria-busy={nativeLaunchPending}
              title={nativeLaunchError || 'Open Codex Native'}
            >
              {nativeLaunchCapability.label || 'Launch native app'}
            </button>
          )}
          {nativeLaunchError && (
            <span className="surface-launch-error" role="status">{nativeLaunchError}</span>
          )}
        </div>
      </header>

      <Sidebar
        providerId={providerId}
        providerLabel={providerLabel}
        providerCommand={providerCommand}
        sessions={sidebarSessions}
        selectedId={sidebarSelectedId}
        previewId={sidebarPreviewId}
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
        coldDays={coldDays}
        onSetColdDays={setColdDays}
      />

      {/* Drag handle — rendered as a sibling of the sidebar so it lives
          outside the sidebar's overflow:hidden / overflow-y:auto context.
          Positioned absolutely on the boundary between the two grid columns
          (see .sidebar-drag-handle in index.css — `left: var(--sidebar-w)`). */}
      {!sidebarCollapsed && (
        <div
          className="sidebar-drag-handle"
          onMouseDown={handleSidebarDragStart}
          title="Drag to resize sidebar"
          role="separator"
          aria-orientation="vertical"
        />
      )}

      <main className="main-area">
        {error && (
          <div className="error-banner"><span>⚠</span> {error}</div>
        )}

        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          sessions={sidebarSessions}
          onActivate={handleActivateTab}
          onTogglePreview={handleTogglePreview}
          onClose={handleCloseTab}
        />

        <div className="tab-content">
          {/* Stacked terminal panes — all stay mounted, visibility toggled.
              Headless tabs render a placeholder instead of <Terminal>:
              there is no PTY to attach to (the run was launched out-of-band)
              so spawning the WS would just 404. */}
          {tabs.map(tab => {
            const tabSession = sidebarSessions.find(s => s.id === tab.id)
            const headless = isHeadless(tabSession)
            const paneActive = tab.id === activeTabId && activeTab?.mode === 'terminal'
            return (
              <div
                key={tab.mountKey}
                className={`tab-pane${paneActive ? ' tab-pane-active' : ''}`}
              >
                {headless ? (
                  <HeadlessPlaceholder session={tabSession} onPreview={handlePreview} />
                ) : (
                  <Terminal
                    providerId={providerId}
                    sessionId={tab.id}
                    active={paneActive}
                    styleId={styleId}
                    textSizeId={textSizeId}
                  />
                )}
              </div>
            )
          })}

          {/* Preview — only rendered for the active tab in preview mode */}
          {activeTab?.mode === 'preview' && (
            <div className="tab-pane tab-pane-active">
              <SessionPreview
                providerId={providerId}
                providerLabel={providerLabel}
                sessionId={activeTabId}
                onResume={handleResume}
                onArchive={handleRemove}
                onRestore={handleRestore}
                onRename={handleRename}
              />
            </div>
          )}

          {/* Splash — shown when no tab is active */}
          {mainView === 'splash' && (
            <div className="tab-pane tab-pane-active">
              <DashboardSplash providerId={providerId} providerLabel={providerLabel} statsEnabled={providerSessionsReady} connected={connected} latestPrompt={latestPrompt} onSelectSession={handlePreview} />
            </div>
          )}
        </div>

        {activeTab?.mode === 'terminal' && selectedSession && !selectedIsHeadless && (
          <PromptStrip prompt={selectedSession.lastUserPrompt || selectedSession.firstUserPrompt} />
        )}
      </main>

      <ControlBar
        providerId={providerId}
        providerLabel={providerLabel}
        session={selectedSession}
        sessionId={activeTabId}
        onRename={handleRename}
        onRemove={handleRemove}
      />
    </div>
  )
}

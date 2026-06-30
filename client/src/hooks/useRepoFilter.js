/**
 * useRepoFilter — three-state repo filter: active / disabled / not-added.
 *
 * Each repo pill can be:
 *   - active   → green pill, sessions shown
 *   - disabled → grey pill, sessions hidden
 *   - (absent) → available in the "+" dropdown
 *
 * State is persisted to localStorage as { repoName: 'active'|'disabled' }.
 * Backward-compatible with legacy string[] format (auto-migrates).
 */
import { useState, useMemo, useEffect, useCallback } from 'react'
import { isHeadless } from '../lib/headless.js'
import { providerStorageKey } from '../lib/providers.js'

function loadRepoFilter(providerId) {
  try {
    const raw = localStorage.getItem(providerStorageKey(providerId, 'visible-repos'))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Legacy migration: string[] → all entries become 'active'
    if (Array.isArray(parsed)) return new Map(parsed.map(r => [r, 'active']))
    // New format: { repoName: 'active' | 'disabled' }
    return new Map(Object.entries(parsed))
  } catch { /* ignore */ }
  return null
}

function saveRepoFilter(providerId, map) {
  try { localStorage.setItem(providerStorageKey(providerId, 'visible-repos'), JSON.stringify(Object.fromEntries(map))) } catch { /* ignore */ }
}

export function useRepoFilter(sessions, providerId) {
  const [repoFilter, setRepoFilter] = useState(() => loadRepoFilter(providerId))

  useEffect(() => {
    setRepoFilter(loadRepoFilter(providerId))
  }, [providerId])

  // Headless sessions are intentionally excluded from the repo-pill universe:
  // there can be a lot of them (one per scheduled run) and the user never
  // needs to filter by their repo individually — they get their own section.
  const interactiveSessions = useMemo(
    () => sessions.filter(s => !isHeadless(s)),
    [sessions]
  )

  // All unique project names from interactive (non-headless) sessions
  const allRepos = useMemo(
    () => [...new Set(interactiveSessions.map(s => s.project).filter(Boolean))].sort(),
    [interactiveSessions]
  )

  // Per-repo aggregates: session count + most recent activity (single pass)
  const { repoSessionCounts, repoLastActivity } = useMemo(() => {
    const counts = {}, lastActivity = {}
    for (const s of interactiveSessions) {
      counts[s.project] = (counts[s.project] || 0) + 1
      if (!lastActivity[s.project] || s.lastActivityAt > lastActivity[s.project])
        lastActivity[s.project] = s.lastActivityAt
    }
    return { repoSessionCounts: counts, repoLastActivity: lastActivity }
  }, [interactiveSessions])

  // Repos shown as pills (in the Map AND still exist in sessions)
  const addedRepos = useMemo(
    () => repoFilter ? [...repoFilter.keys()].filter(r => allRepos.includes(r)) : [],
    [repoFilter, allRepos]
  )

  // Hidden repos sorted by most recent session activity (descending)
  const sortedHiddenRepos = useMemo(() => {
    const hidden = allRepos.filter(r => !repoFilter?.has(r))
    hidden.sort((a, b) => (repoLastActivity[b] || 0) - (repoLastActivity[a] || 0))
    return hidden
  }, [allRepos, repoFilter, repoLastActivity])

  // Set of active-only repo names (for session filtering)
  const activeRepos = useMemo(
    () => repoFilter
      ? new Set([...repoFilter.entries()].filter(([, v]) => v === 'active').map(([k]) => k))
      : new Set(),
    [repoFilter]
  )

  // Auto-initialize on first session load.  Seed from the most-recent
  // *interactive* session — never a headless one, because headless projects
  // don't render as chips and the user would have no way to deactivate the
  // resulting zombie filter.
  useEffect(() => {
    if (repoFilter !== null || interactiveSessions.length === 0) return
    const mostRecent = interactiveSessions[0]?.project
    if (mostRecent) {
      const initial = new Map([[mostRecent, 'active']])
      setRepoFilter(initial)
      saveRepoFilter(providerId, initial)
    }
  }, [interactiveSessions, repoFilter, providerId])

  const addRepo = useCallback((repo) => {
    setRepoFilter(prev => {
      const next = new Map(prev ?? [])
      next.set(repo, 'active')
      saveRepoFilter(providerId, next)
      return next
    })
  }, [providerId])

  const removeRepo = useCallback((repo) => {
    setRepoFilter(prev => {
      const next = new Map(prev ?? [])
      next.delete(repo)
      saveRepoFilter(providerId, next)
      return next
    })
  }, [providerId])

  const toggleRepo = useCallback((repo) => {
    setRepoFilter(prev => {
      const next = new Map(prev ?? [])
      next.set(repo, next.get(repo) === 'active' ? 'disabled' : 'active')
      saveRepoFilter(providerId, next)
      return next
    })
  }, [providerId])

  // Bulk add every repo as active. Used by the "All" button so the user
  // doesn't have to add repos one-at-a-time through the "+" dropdown.
  const addAllRepos = useCallback(() => {
    setRepoFilter(prev => {
      const next = new Map(prev ?? [])
      for (const r of allRepos) next.set(r, 'active')
      saveRepoFilter(providerId, next)
      return next
    })
  }, [allRepos, providerId])

  // Clear every pill — counterpart to addAllRepos for the toggle.
  const clearAllRepos = useCallback(() => {
    setRepoFilter(() => {
      const next = new Map()
      saveRepoFilter(providerId, next)
      return next
    })
  }, [providerId])

  return {
    repoFilter,
    allRepos,
    addedRepos,
    sortedHiddenRepos,
    activeRepos,
    repoSessionCounts,
    addRepo,
    removeRepo,
    toggleRepo,
    addAllRepos,
    clearAllRepos,
  }
}

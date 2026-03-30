/**
 * useStatusFeed — subscribes to the server's /ws/status WebSocket
 * and returns a live-updating list of sessions.
 *
 * Reconnects automatically on disconnect (exponential back-off up to 10s).
 *
 * Also tracks per-session "last viewed at" in localStorage so AgentCard
 * can compute the unread (red dot) state client-side without server changes.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
const INITIAL_BACKOFF = 500
const MAX_BACKOFF = 10_000
const VIEWED_KEY = 'devin-dash:viewed-at'

function loadViewed() {
  try { return JSON.parse(localStorage.getItem(VIEWED_KEY) || '{}') } catch { return {} }
}
function saveViewed(map) {
  try { localStorage.setItem(VIEWED_KEY, JSON.stringify(map)) } catch {}
}

export function useStatusFeed() {
  const [sessions, setSessions] = useState([])
  const [latestPrompt, setLatestPrompt] = useState(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  // viewedAt: { [sessionId]: epochMs } — when user last opened that session
  const [viewedAt, setViewedAt] = useState(loadViewed)
  const wsRef = useRef(null)
  const backoffRef = useRef(INITIAL_BACKOFF)
  const retryRef = useRef(null)
  const unmountedRef = useRef(false)

  // Call this when the user selects a session card
  const markViewed = useCallback((id) => {
    setViewedAt(prev => {
      const next = { ...prev, [id]: Date.now() }
      saveViewed(next)
      return next
    })
  }, [])

  const connect = useCallback(() => {
    if (unmountedRef.current) return

    const ws = new WebSocket(`${WS_BASE}/ws/status`)
    wsRef.current = ws

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return }
      setConnected(true)
      setError(null)
      backoffRef.current = INITIAL_BACKOFF
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'sessions') setSessions(msg.data)
        else if (msg.type === 'latest-prompt') setLatestPrompt(msg.data)
      } catch {
        // Ignore malformed frames
      }
    }

    ws.onerror = () => {
      setError('Connection error — retrying…')
    }

    ws.onclose = () => {
      if (unmountedRef.current) return
      setConnected(false)

      retryRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 1.5, MAX_BACKOFF)
        connect()
      }, backoffRef.current)
    }
  }, [])

  useEffect(() => {
    unmountedRef.current = false
    connect()
    return () => {
      unmountedRef.current = true
      clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { sessions, connected, error, latestPrompt, viewedAt, markViewed }
}

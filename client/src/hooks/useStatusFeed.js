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

export function useStatusFeed() {
  const [sessions, setSessions] = useState([])
  const [latestPrompt, setLatestPrompt] = useState(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  // rekeyMap: { [tempKey]: realId } — pending sessions that have been re-keyed
  const [rekeyMap, setRekeyMap] = useState({})
  const wsRef = useRef(null)
  const backoffRef = useRef(INITIAL_BACKOFF)
  const retryRef = useRef(null)
  const unmountedRef = useRef(false)

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
        if (msg.type === 'sessions') {
          // Reference-preserving diff: reuse previous session objects when
          // nothing meaningful changed. This lets React.memo on AgentCard
          // skip re-renders for unchanged sessions.
          setSessions(prev => {
            if (!prev.length) return msg.data
            const prevMap = new Map(prev.map(s => [s.id, s]))
            let changed = prev.length !== msg.data.length
            const next = msg.data.map(s => {
              const old = prevMap.get(s.id)
              if (old
                && old.status === s.status
                && old.snippet === s.snippet
                && old.lastActivityAt === s.lastActivityAt
                && old.title === s.title
                && old.lastUserPrompt === s.lastUserPrompt
                && old.hasSubagents === s.hasSubagents) {
                return old  // reuse reference — unchanged
              }
              changed = true
              return s      // new reference — something changed
            })
            return changed ? next : prev
          })
        }
        else if (msg.type === 'latest-prompt') setLatestPrompt(msg.data)
        else if (msg.type === 'rekey' && msg.tempKey && msg.realId) {
          setRekeyMap(prev => ({ ...prev, [msg.tempKey]: msg.realId }))
        }
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

  return { sessions, connected, error, latestPrompt, rekeyMap }
}

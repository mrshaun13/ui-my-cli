/**
 * useStatusFeed — subscribes to the server's /ws/status WebSocket
 * and returns a live-updating list of sessions.
 *
 * Reconnects automatically on disconnect (exponential back-off up to 10s).
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
const INITIAL_BACKOFF = 500
const MAX_BACKOFF = 10_000

export function useStatusFeed() {
  const [sessions, setSessions] = useState([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
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
        if (msg.type === 'sessions') setSessions(msg.data)
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

  return { sessions, connected, error }
}

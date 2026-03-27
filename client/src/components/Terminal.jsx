/**
 * Terminal — renders an xterm.js terminal connected to the server PTY via WebSocket.
 *
 * Reconnect strategy:
 *   On any WebSocket close (server restart, network blip, etc.) the terminal
 *   automatically attempts to reconnect with exponential back-off.
 *   The xterm instance is preserved across reconnects so scroll history survives.
 *   Only a deliberate session switch (new sessionId prop) fully remounts.
 *
 * WebSocket protocol:
 *   Client → Server: { type: 'input', data } | { type: 'resize', cols, rows }
 *   Server → Client: { type: 'output', data } | { type: 'exit', exitCode }
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`

const XTERM_THEME = {
  background:    '#020507',
  foreground:    '#b0c8e0',
  cursor:        '#00ffa3',
  cursorAccent:  '#020507',
  selectionBackground: 'rgba(0,255,163,0.15)',
  black:         '#0d1117',
  brightBlack:   '#3d5470',
  red:           '#ff4d6a',
  brightRed:     '#ff7088',
  green:         '#00ffa3',
  brightGreen:   '#4dffc4',
  yellow:        '#f5c542',
  brightYellow:  '#ffd766',
  blue:          '#4d9fff',
  brightBlue:    '#80baff',
  magenta:       '#9d6fff',
  brightMagenta: '#bf9fff',
  cyan:          '#00d4e8',
  brightCyan:    '#40e8f8',
  white:         '#b0c8e0',
  brightWhite:   '#e2e8f0',
}

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000] // ms, capped at last value

export default function Terminal({ sessionId }) {
  const containerRef   = useRef(null)
  const xtermRef       = useRef(null)
  const fitAddonRef    = useRef(null)
  const wsRef          = useRef(null)
  const retryRef       = useRef(null)
  const retryCountRef  = useRef(0)
  const destroyedRef   = useRef(false)  // true when component is unmounting

  const [wsState, setWsState] = useState('connecting') // 'connecting' | 'open' | 'reconnecting' | 'exited'
  const [exitCode, setExitCode] = useState(null)

  // ── xterm setup (once per sessionId) ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    destroyedRef.current = false
    retryCountRef.current = 0

    const xterm = new XTerm({
      theme: XTERM_THEME,
      fontFamily: '"Berkeley Mono", "Cascadia Code", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(new WebLinksAddon())
    xterm.open(containerRef.current)
    fitAddon.fit()

    xtermRef.current   = xterm
    fitAddonRef.current = fitAddon

    // Resize observer — debounced to avoid storms
    const observer = new ResizeObserver(() => {
      clearTimeout(observer._t)
      observer._t = setTimeout(() => {
        if (!fitAddonRef.current || !xtermRef.current) return
        fitAddonRef.current.fit()
        const ws = wsRef.current
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: xtermRef.current.cols, rows: xtermRef.current.rows }))
        }
      }, 60)
    })
    observer.observe(containerRef.current)

    return () => {
      destroyedRef.current = true
      clearTimeout(retryRef.current)
      observer.disconnect()
      wsRef.current?.close()
      xterm.dispose()
      xtermRef.current   = null
      fitAddonRef.current = null
      wsRef.current      = null
    }
  }, [sessionId])

  // ── WebSocket connect / reconnect ────────────────────────────────────────────
  const connect = useCallback(() => {
    if (destroyedRef.current) return

    const xterm    = xtermRef.current
    const fitAddon = fitAddonRef.current
    if (!xterm || !fitAddon) return

    setWsState('connecting')

    const params = new URLSearchParams({
      cols: String(xterm.cols),
      rows: String(xterm.rows),
    })
    const ws = new WebSocket(`${WS_BASE}/ws/terminal/${sessionId}?${params}`)
    wsRef.current = ws

    ws.onopen = () => {
      if (destroyedRef.current) { ws.close(); return }
      retryCountRef.current = 0
      setWsState('open')
      setExitCode(null)
      xterm.focus()
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'output') xterm.write(msg.data)
        if (msg.type === 'exit')   { setExitCode(msg.exitCode); setWsState('exited') }
      } catch {
        xterm.write(evt.data)
      }
    }

    ws.onerror = () => {
      // onerror always fires before onclose — nothing to do here, onclose handles it
    }

    ws.onclose = (evt) => {
      if (destroyedRef.current) return

      // Normal PTY exit — don't reconnect
      if (wsState === 'exited') return

      const delay = RECONNECT_DELAYS[Math.min(retryCountRef.current, RECONNECT_DELAYS.length - 1)]
      retryCountRef.current++

      xterm.writeln(`\r\n\x1b[33m[disconnected — reconnecting in ${delay / 1000}s…]\x1b[0m`)
      setWsState('reconnecting')

      retryRef.current = setTimeout(() => {
        if (!destroyedRef.current) connect()
      }, delay)
    }

    // Forward keystrokes to PTY
    xterm.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Kick off initial connection after xterm is mounted
  useEffect(() => {
    // Wait one tick so the xterm useEffect above runs first
    const t = setTimeout(connect, 0)
    return () => clearTimeout(t)
  }, [connect])

  const manualReconnect = () => {
    clearTimeout(retryRef.current)
    retryCountRef.current = 0
    wsRef.current?.close()
    connect()
  }

  const isConnecting   = wsState === 'connecting'
  const isReconnecting = wsState === 'reconnecting'
  const isExited       = wsState === 'exited'

  return (
    <div className="terminal-wrap">
      {isConnecting && (
        <div className="terminal-loading">
          <div className="spinner" />
          Connecting to agent…
        </div>
      )}

      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', display: isConnecting ? 'none' : 'block' }}
      />

      {(isReconnecting || isExited) && (
        <div className="terminal-overlay-badge">
          {isExited
            ? `Session exited (code ${exitCode ?? '?'})`
            : `Reconnecting…`
          }
          <button
            className="btn btn-primary"
            style={{ padding: '3px 10px', fontSize: '10px' }}
            onClick={manualReconnect}
          >
            Reconnect now
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Terminal — xterm.js terminal connected to the server PTY via WebSocket.
 *
 * Design constraints:
 *   - xterm instance is created ONCE per sessionId and never recreated on reconnect.
 *     This preserves scrollback history across connection drops.
 *   - onData (keyboard → PTY) is registered ONCE on xterm, held in a ref.
 *     The ref always points at the current live WebSocket so we never leak listeners.
 *   - WebSocket is torn down and rebuilt on reconnect without touching xterm.
 *   - key={sessionId} on this component in App.jsx guarantees a full remount
 *     when switching sessions, so there is no cross-session state bleed.
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
  black:         '#0d1117',  brightBlack:   '#3d5470',
  red:           '#ff4d6a',  brightRed:     '#ff7088',
  green:         '#00ffa3',  brightGreen:   '#4dffc4',
  yellow:        '#f5c542',  brightYellow:  '#ffd766',
  blue:          '#4d9fff',  brightBlue:    '#80baff',
  magenta:       '#9d6fff',  brightMagenta: '#bf9fff',
  cyan:          '#00d4e8',  brightCyan:    '#40e8f8',
  white:         '#b0c8e0',  brightWhite:   '#e2e8f0',
}

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000]

export default function Terminal({ sessionId }) {
  const containerRef  = useRef(null)
  const xtermRef      = useRef(null)
  const fitAddonRef   = useRef(null)
  // wsRef always points at the CURRENT live WebSocket.
  // onData reads this ref — no listener rebinding needed on reconnect.
  const wsRef         = useRef(null)
  const retryRef      = useRef(null)
  const retryCountRef = useRef(0)
  const mountedRef    = useRef(true)  // false after unmount

  const [wsState, setWsState]   = useState('connecting')
  const [exitCode, setExitCode] = useState(null)

  // ── Create xterm once per sessionId ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    mountedRef.current    = true
    retryCountRef.current = 0

    const xterm    = new XTerm({
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

    xtermRef.current    = xterm
    fitAddonRef.current = fitAddon

    // Smart Ctrl+C — mirrors WSL terminal behaviour:
    //   Ctrl+C with selection → copy to clipboard, swallow the keypress
    //   Ctrl+C without selection → pass \x03 (SIGINT) through to PTY
    // Paste (Ctrl+V) is handled natively by xterm's hidden textarea —
    // pasted text flows through onData like normal keyboard input.
    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true

      if (e.ctrlKey && e.key === 'c') {
        const sel = xterm.getSelection()
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {})
          xterm.clearSelection()
          return false  // swallow — don't send \x03 to PTY
        }
        return true  // no selection — let SIGINT through normally
      }

      return true
    })

    // Register onData ONCE. It writes to wsRef.current so it always uses
    // the live socket without ever being re-registered.
    xterm.onData(data => {
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Resize observer — debounced
    const observer = new ResizeObserver(() => {
      clearTimeout(observer._t)
      observer._t = setTimeout(() => {
        if (!fitAddonRef.current || !xtermRef.current) return
        try { fitAddonRef.current.fit() } catch { return }
        const ws = wsRef.current
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows,
          }))
        }
      }, 60)
    })
    observer.observe(containerRef.current)

    return () => {
      mountedRef.current = false
      clearTimeout(retryRef.current)
      observer.disconnect()
      // Close socket cleanly — onclose will fire but mountedRef guards the retry
      wsRef.current?.close()
      wsRef.current = null
      xterm.dispose()
      xtermRef.current    = null
      fitAddonRef.current = null
    }
  }, [sessionId]) // full remount on session switch — guaranteed by key={sessionId} in App

  // ── WebSocket connect / auto-reconnect ───────────────────────────────────
  const connect = useCallback(() => {
    if (!mountedRef.current) return
    const xterm    = xtermRef.current
    const fitAddon = fitAddonRef.current
    if (!xterm || !fitAddon) return

    setWsState('connecting')

    const params = new URLSearchParams({
      cols: String(xterm.cols),
      rows: String(xterm.rows),
    })
    const ws = new WebSocket(`${WS_BASE}/ws/terminal/${sessionId}?${params}`)
    wsRef.current = ws  // point the ref at the new socket immediately

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return }
      retryCountRef.current = 0
      setWsState('open')
      setExitCode(null)
      xterm.focus()
    }

    ws.onmessage = ({ data: raw }) => {
      try {
        const msg = JSON.parse(raw)
        if (msg.type === 'output') xterm.write(msg.data)
        if (msg.type === 'exit')   { setExitCode(msg.exitCode); setWsState('exited') }
      } catch {
        xterm.write(raw)
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      // wsRef might already point at a newer socket if we reconnected quickly
      if (wsRef.current !== ws) return

      const delay = RECONNECT_DELAYS[Math.min(retryCountRef.current, RECONNECT_DELAYS.length - 1)]
      retryCountRef.current++
      setWsState('reconnecting')
      xterm.writeln(`\r\n\x1b[33m[connection lost — retrying in ${delay / 1000}s]\x1b[0m`)

      retryRef.current = setTimeout(() => {
        if (mountedRef.current) connect()
      }, delay)
    }

    ws.onerror = () => { /* onclose always follows — handled there */ }
  }, [sessionId])

  // Start connection after xterm is mounted (next tick)
  useEffect(() => {
    const t = setTimeout(connect, 0)
    return () => clearTimeout(t)
  }, [connect])

  const manualReconnect = () => {
    clearTimeout(retryRef.current)
    retryCountRef.current = 0
    setWsState('connecting')
    const old = wsRef.current
    wsRef.current = null
    old?.close()
    setTimeout(connect, 50)
  }

  return (
    <div className="terminal-wrap">
      {wsState === 'connecting' && (
        <div className="terminal-loading">
          <div className="spinner" />
          Connecting to agent…
        </div>
      )}

      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', visibility: wsState === 'connecting' ? 'hidden' : 'visible' }}
      />

      {(wsState === 'reconnecting' || wsState === 'exited') && (
        <div className="terminal-overlay-badge">
          {wsState === 'exited'
            ? `Process exited (code ${exitCode ?? '?'})`
            : 'Connection lost — retrying…'
          }
          <button
            className="btn btn-primary"
            style={{ padding: '3px 10px', fontSize: '10px', marginLeft: '8px' }}
            onClick={manualReconnect}
          >
            Reconnect now
          </button>
        </div>
      )}
    </div>
  )
}

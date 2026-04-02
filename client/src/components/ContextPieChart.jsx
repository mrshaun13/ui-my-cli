/**
 * ContextPieChart — compact SVG donut chart for the topbar.
 *
 * Shows context window usage as a small donut in the header.
 * Hover over any segment to see a tooltip with label, token count, and %.
 * No legend, no compaction badge — just the donut + center text.
 *
 * Updates per-session via GET /api/sessions/:id/context.
 */

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'

const CATEGORIES = [
  { key: 'systemPrompt',       label: 'System prompt', color: 'var(--yellow)' },
  { key: 'userMessages',       label: 'User msgs',     color: 'var(--blue)' },
  { key: 'assistantMessages',  label: 'Assistant',      color: 'var(--accent)' },
  { key: 'toolCalls',          label: 'Tool calls',     color: 'var(--purple)' },
  { key: 'toolResults',        label: 'Tool results',   color: 'var(--cyan)' },
]

const FREE_COLOR = 'var(--bg-elevated)'

function formatTokens(n) {
  if (!n) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const delta = endAngle - startAngle
  if (delta >= Math.PI * 2 - 0.001) {
    const mid = startAngle + Math.PI
    return [
      `M ${cx + r * Math.cos(startAngle)} ${cy + r * Math.sin(startAngle)}`,
      `A ${r} ${r} 0 0 1 ${cx + r * Math.cos(mid)} ${cy + r * Math.sin(mid)}`,
      `A ${r} ${r} 0 0 1 ${cx + r * Math.cos(startAngle + Math.PI * 2 - 0.001)} ${cy + r * Math.sin(startAngle + Math.PI * 2 - 0.001)}`,
    ].join(' ')
  }
  const largeArc = delta > Math.PI ? 1 : 0
  return [
    `M ${cx + r * Math.cos(startAngle)} ${cy + r * Math.sin(startAngle)}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${cx + r * Math.cos(endAngle)} ${cy + r * Math.sin(endAngle)}`,
  ].join(' ')
}

export default function ContextPieChart({ sessionId, tooltipPosition }) {
  const [data, setData] = useState(null)
  const [hover, setHover] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!sessionId) { setData(null); return }
    setHover(null)
    let cancelled = false

    const fetchContext = () => {
      fetch(`/api/sessions/${sessionId}/context`)
        .then(r => { if (!r.ok) throw new Error('context fetch failed'); return r.json() })
        .then(d => { if (!cancelled) setData(d) })
        .catch(() => { if (!cancelled) setData(null) })
    }

    fetchContext()
    const interval = setInterval(fetchContext, 15_000) // refresh every 15s

    return () => { cancelled = true; clearInterval(interval) }
  }, [sessionId])

  if (!data) return null

  const { categories, totalUsed, maxContext, freeTokens } = data

  const segments = []
  for (const cat of CATEGORIES) {
    const tokens = categories[cat.key] || 0
    if (tokens > 0) segments.push({ key: cat.key, label: cat.label, tokens, color: cat.color })
  }
  segments.push({ key: 'free', label: 'Free', tokens: freeTokens, color: FREE_COLOR })

  const total = maxContext || 1
  const usedPct = Math.round((totalUsed / total) * 100)

  const size = 48
  const cx = size / 2
  const cy = size / 2
  const r = 17
  const strokeWidth = 7

  let angle = -Math.PI / 2
  const arcs = segments.map(seg => {
    const pct = seg.tokens / total
    const startAngle = angle
    const sweep = pct * Math.PI * 2
    angle += sweep
    return { ...seg, startAngle, endAngle: startAngle + sweep, pct }
  })

  const hovered = hover ? arcs.find(a => a.key === hover) : null

  return (
    <div className="ctx-pie-topbar" ref={wrapRef}>
      <svg
        width={size} height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="ctx-pie-svg"
      >
        {arcs.map(arc => {
          if (arc.pct < 0.005) return null
          const isHov = hover === arc.key
          return (
            <path
              key={arc.key}
              d={arcPath(cx, cy, r, arc.startAngle, arc.endAngle)}
              fill="none"
              stroke={arc.color}
              strokeWidth={isHov ? strokeWidth + 2 : strokeWidth}
              strokeLinecap="butt"
              opacity={hover && !isHov ? 0.3 : 1}
              onMouseEnter={() => setHover(arc.key)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default', transition: 'opacity 0.12s, stroke-width 0.12s' }}
            />
          )
        })}
      </svg>

      <div className="ctx-pie-topbar-info">
        <span className="ctx-pie-topbar-label">context</span>
        <span className="ctx-pie-topbar-stats" style={{ color: usedPct > 80 ? 'var(--yellow)' : 'var(--text-secondary)' }}>
          {formatTokens(totalUsed)}<span className="ctx-pie-topbar-sep">/</span>{formatTokens(maxContext)}
          <span className="ctx-pie-topbar-pct" style={{ color: usedPct > 80 ? 'var(--yellow)' : 'var(--text-muted)' }}>
            ({usedPct}% used)
          </span>
        </span>
      </div>

      {/* Hover tooltip — rendered via portal so it's never clipped */}
      {hovered && (() => {
        const r = wrapRef.current?.getBoundingClientRect()
        if (!r) return null
        const style = tooltipPosition === 'above'
          ? { bottom: window.innerHeight - r.top + 6, right: window.innerWidth - r.right }
          : { top: r.bottom + 6, right: window.innerWidth - r.right }
        return createPortal(
          <div className="ctx-pie-tooltip ctx-pie-tooltip-portal" style={style}>
            <span className="ctx-pie-tooltip-dot" style={{ background: hovered.color }} />
            <span className="ctx-pie-tooltip-label">{hovered.label}</span>
            <span className="ctx-pie-tooltip-value">{formatTokens(hovered.tokens)}</span>
            <span className="ctx-pie-tooltip-pct">{Math.round(hovered.pct * 100)}%</span>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}

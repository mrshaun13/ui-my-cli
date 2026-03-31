/**
 * ContextPieChart — SVG donut chart showing context window breakdown.
 *
 * Displayed in the top-right of SessionPreview, always visible when a
 * session is selected. Updates per-session via GET /api/sessions/:id/context.
 *
 * Shows: system prompt, user messages, assistant messages, tool calls,
 *        tool results, and free window capacity.
 */

import { useEffect, useState } from 'react'

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

/**
 * Builds SVG arc path for a donut segment.
 * cx, cy = center; r = radius; startAngle, endAngle in radians; stroke-width handled externally.
 */
function arcPath(cx, cy, r, startAngle, endAngle) {
  // Clamp to avoid full-circle path issues
  const delta = endAngle - startAngle
  if (delta >= Math.PI * 2 - 0.001) {
    // Full circle: use two half-arcs
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

export default function ContextPieChart({ sessionId }) {
  const [data, setData] = useState(null)
  const [hover, setHover] = useState(null) // category key or 'free'

  useEffect(() => {
    if (!sessionId) return
    setData(null)
    setHover(null)
    let cancelled = false
    fetch(`/api/sessions/${sessionId}/context`)
      .then(r => { if (!r.ok) throw new Error('context fetch failed'); return r.json() })
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [sessionId])

  if (!data) return null

  const { categories, totalUsed, maxContext, freeTokens } = data

  // Build segments: categories + free
  const segments = []
  for (const cat of CATEGORIES) {
    const tokens = categories[cat.key] || 0
    if (tokens > 0) {
      segments.push({ key: cat.key, label: cat.label, tokens, color: cat.color })
    }
  }
  segments.push({ key: 'free', label: 'Free', tokens: freeTokens, color: FREE_COLOR })

  const total = maxContext || 1
  const usedPct = Math.round((totalUsed / total) * 100)

  // SVG dimensions
  const size = 120
  const cx = size / 2
  const cy = size / 2
  const r = 44
  const strokeWidth = 16

  // Build arcs
  let angle = -Math.PI / 2 // start at top
  const arcs = segments.map(seg => {
    const pct = seg.tokens / total
    const startAngle = angle
    const sweep = pct * Math.PI * 2
    angle += sweep
    return { ...seg, startAngle, endAngle: startAngle + sweep, pct }
  })

  // Hover detail
  const hovered = hover ? arcs.find(a => a.key === hover) : null

  return (
    <div className="ctx-pie-wrap">
      <div className="ctx-pie-header">
        <span className="ctx-pie-title">Context Window</span>
        <span className="ctx-pie-pct" style={{ color: usedPct > 80 ? 'var(--yellow)' : 'var(--text-muted)' }}>
          {usedPct}% used
        </span>
      </div>

      <div className="ctx-pie-body">
        <svg
          width={size} height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="ctx-pie-svg"
        >
          {arcs.map(arc => {
            if (arc.pct < 0.002) return null // skip tiny segments
            const isHov = hover === arc.key
            return (
              <path
                key={arc.key}
                d={arcPath(cx, cy, r, arc.startAngle, arc.endAngle)}
                fill="none"
                stroke={arc.color}
                strokeWidth={isHov ? strokeWidth + 3 : strokeWidth}
                strokeLinecap="butt"
                opacity={hover && !isHov ? 0.35 : 1}
                onMouseEnter={() => setHover(arc.key)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'default', transition: 'opacity 0.15s, stroke-width 0.15s' }}
              />
            )
          })}
          {/* Center text */}
          <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--text-primary)"
            fontSize="14" fontWeight="600" fontFamily="var(--font-mono)">
            {formatTokens(totalUsed)}
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" fill="var(--text-muted)"
            fontSize="9" fontFamily="var(--font-mono)">
            / {formatTokens(maxContext)}
          </text>
        </svg>

        {/* Legend */}
        <div className="ctx-pie-legend">
          {arcs.map(arc => {
            if (arc.pct < 0.01 && arc.key !== 'free') return null
            const isHov = hover === arc.key
            return (
              <div
                key={arc.key}
                className={`ctx-pie-legend-row${isHov ? ' ctx-pie-legend-active' : ''}`}
                onMouseEnter={() => setHover(arc.key)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="ctx-pie-legend-dot" style={{ background: arc.color }} />
                <span className="ctx-pie-legend-label">{arc.label}</span>
                <span className="ctx-pie-legend-value">{formatTokens(arc.tokens)}</span>
                <span className="ctx-pie-legend-pct">{Math.round(arc.pct * 100)}%</span>
              </div>
            )
          })}
        </div>
      </div>

      {data.compactionCount > 0 && (
        <div className="ctx-pie-compactions">
          {data.compactionCount} compaction{data.compactionCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

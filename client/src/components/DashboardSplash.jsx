/**
 * DashboardSplash — shown when no session is selected.
 *
 * Layout:
 *   Top: latest-prompt live banner
 *   Two-column body:
 *     Left:  tabbed activity chart (24h / 48h / 7-day) · project breakdown
 *     Right: tool call bar chart · model usage
 */

import { useEffect, useRef, useState } from 'react'

export function useStats() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => { if (!cancelled) setStats(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  return { stats, error }
}

// ── Latest prompt — polls every 5 s ─────────────────────────────────────────
// NOTE: Dead code — prompt strip is now session-scoped in App.jsx (lastUserPrompt).
// Kept only to avoid removing InfoTip which is still used below.

// A small ⓘ circle that shows a tooltip on hover.

function InfoTip({ text }) {
  const [show, setShow] = useState(false)
  return (
    <span className="info-tip-wrap"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}>
      <span className="info-tip-icon">ⓘ</span>
      {show && <span className="info-tip-bubble">{text}</span>}
    </span>
  )
}

// ── Latest prompt banner — prop-driven, no polling ───────────────────────────

function LatestPromptBanner({ prompt }) {
  if (!prompt) return null
  const secs = Math.floor(Date.now() / 1000) - prompt.timestamp
  const ago = secs < 60 ? `${secs}s ago` : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`
  return (
    <div className="latest-prompt-banner">
      <span className="latest-prompt-label">last prompt</span>
      <span className="latest-prompt-text">{prompt.content}</span>
      <span className="latest-prompt-age">{ago}</span>
    </div>
  )
}

// ── Shared chart constants ────────────────────────────────────────────────────

const CHART_H = 72
const CHART_W = 420

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21].map(h => ({
  h,
  x: ((h / 23) * (CHART_W - 8) + 4).toFixed(1),
  label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`,
}))

function fmtHour(h) {
  if (h === 0)  return '12am'
  if (h < 12)  return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

// ── 24h / 48h line chart ──────────────────────────────────────────────────────

function HourLineChart({ series, color, label }) {
  const max = Math.max(...series, 1)
  const [hover, setHover] = useState(null)

  const pts = series.map((v, i) => {
    const x = (i / 23) * (CHART_W - 8) + 4
    const y = CHART_H - 4 - (v / max) * (CHART_H - 8)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <div className="activity-chart-wrap">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H + 16}`}
        preserveAspectRatio="none"
        className="activity-chart-svg"
      >
        {[0.25, 0.5, 0.75, 1].map(f => {
          const y = (CHART_H - 4 - f * (CHART_H - 8)).toFixed(1)
          return <line key={f} x1="4" x2={CHART_W - 4} y1={y} y2={y}
            stroke="var(--border)" strokeWidth="0.5" />
        })}

        {HOUR_LABELS.map(({ h, x, label: lbl }) => (
          <text key={h} x={x} y={CHART_H + 13} textAnchor="middle"
            fill="var(--text-muted)" fontSize="7" fontFamily="var(--font-mono)">
            {lbl}
          </text>
        ))}

        <polyline points={pts} fill="none" stroke={color}
          strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />

        {series.map((v, i) => {
          const x = (i / 23) * (CHART_W - 8) + 4
          const y = CHART_H - 4 - (v / max) * (CHART_H - 8)
          const tipW = 110
          const tipX = Math.max(4, Math.min(x - tipW / 2, CHART_W - tipW - 4))
          return (
            <g key={i}
              onMouseEnter={() => setHover({ i, v, x, y })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}>
              <rect x={x - 7} y={0} width={14} height={CHART_H + 2} fill="transparent" />
              {hover?.i === i && (
                <>
                  <line x1={x} x2={x} y1={4} y2={CHART_H - 4}
                    stroke={color} strokeWidth="0.8" strokeDasharray="2,2" opacity="0.5" />
                  {v > 0 && <circle cx={x} cy={y} r={3} fill={color} />}
                  <rect x={tipX} y={2} width={tipW} height={15} rx={3}
                    fill="var(--bg-elevated)" stroke="var(--border-bright)" strokeWidth="0.8" />
                  <text x={tipX + tipW / 2} y={13} textAnchor="middle"
                    fill="var(--text-primary)" fontSize="8" fontFamily="var(--font-mono)">
                    {fmtHour(i)}–{fmtHour((i + 1) % 24)}: {v} AI turns
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>
      <div className="activity-chart-legend">
        <span className="legend-dot" style={{ background: color }} />
        <span className="legend-label">{label} · hover for counts</span>
      </div>
    </div>
  )
}

// ── 7-day heatmap (hour × day grid) ──────────────────────────────────────────

function WeekHeatmap({ days }) {
  const [hover, setHover] = useState(null)
  const allVals = days.flatMap(d => d.hours)
  const maxVal = Math.max(...allVals, 1)

  const CELL_W = 15
  const CELL_H = 9
  const LABEL_W = 26
  const HOUR_HEADER = 12
  const GRID_W = 24 * CELL_W

  const hourLabelIdxs = [0, 3, 6, 9, 12, 15, 18, 21]

  function cellColor(v) {
    if (v === 0) return 'var(--bg-elevated)'
    const intensity = v / maxVal
    const alpha = 0.12 + intensity * 0.88
    return `rgba(56, 217, 169, ${alpha.toFixed(2)})`
  }

  return (
    <div className="activity-chart-wrap" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${LABEL_W + GRID_W + 4} ${HOUR_HEADER + 7 * CELL_H + 2}`}
        className="activity-chart-svg"
        style={{ height: '92px' }}
      >
        {hourLabelIdxs.map(h => {
          const x = LABEL_W + h * CELL_W + CELL_W / 2
          const lbl = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`
          return (
            <text key={h} x={x} y={9} textAnchor="middle"
              fill="var(--text-muted)" fontSize="6.5" fontFamily="var(--font-mono)">
              {lbl}
            </text>
          )
        })}

        {days.map((day, di) => {
          const y = HOUR_HEADER + di * CELL_H
          return (
            <g key={day.date}>
              <text x={LABEL_W - 4} y={y + CELL_H * 0.72} textAnchor="end"
                fill="var(--text-muted)" fontSize="6.5" fontFamily="var(--font-mono)">
                {day.label}
              </text>
              {day.hours.map((v, hi) => {
                const cx = LABEL_W + hi * CELL_W
                const isHov = hover?.di === di && hover?.hi === hi
                return (
                  <g key={hi}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.closest('svg').getBoundingClientRect()
                      const wrap = e.currentTarget.closest('.activity-chart-wrap').getBoundingClientRect()
                      setHover({
                        di, hi, v, day,
                        px: e.clientX - wrap.left + 8,
                        py: e.clientY - wrap.top - 36,
                      })
                    }}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'default' }}>
                    <rect
                      x={cx + 0.5} y={y + 0.5}
                      width={CELL_W - 1} height={CELL_H - 1}
                      rx={1}
                      fill={cellColor(v)}
                      stroke={isHov ? 'var(--accent)' : 'transparent'}
                      strokeWidth="0.8"
                    />
                  </g>
                )
              })}
            </g>
          )
        })}

      </svg>

      {/* HTML tooltip — rendered outside SVG so it's never clipped */}
      {hover && (
        <div className="heatmap-tooltip" style={{ left: hover.px, top: hover.py }}>
          <span className="heatmap-tooltip-day">{hover.day.label} {hover.day.date.slice(5)}</span>
          <span className="heatmap-tooltip-sep">·</span>
          <span>{fmtHour(hover.hi)}–{fmtHour((hover.hi + 1) % 24)}</span>
          <span className="heatmap-tooltip-sep">·</span>
          <span className="heatmap-tooltip-count">{hover.v} turn{hover.v !== 1 ? 's' : ''}</span>
        </div>
      )}

      <div className="activity-chart-legend">
        <span className="legend-label" style={{ color: 'var(--text-muted)' }}>
          last 7 days · darker = more activity · hover for counts
        </span>
      </div>
    </div>
  )
}

// ── Tabbed Activity Chart container ──────────────────────────────────────────

const ACTIVITY_TABS = [
  { key: '24h', label: 'Last 24h' },
  { key: '48h', label: '24–48h' },
  { key: '7d',  label: '7-day grid' },
]

const ACTIVITY_TIP =
  'An "AI turn" is one message node in a Devin conversation — every assistant reply, ' +
  'tool call, or tool result counts as one turn. A single prompt you type may generate ' +
  '10–50 turns as the agent reasons and uses tools. High counts = heavy activity.'

function ActivityChart({ data }) {
  const [tab, setTab] = useState('24h')
  const { b24, b48, b7d } = data

  return (
    <div className="act-tabs-wrap">
      <div className="act-tabs">
        {ACTIVITY_TABS.map(t => (
          <button
            key={t.key}
            className={`act-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === '24h' && <HourLineChart series={b24} color="var(--accent)" label="last 24 h" />}
      {tab === '48h' && <HourLineChart series={b48} color="var(--blue)" label="24–48 h ago" />}
      {tab === '7d'  && <WeekHeatmap days={b7d} />}
    </div>
  )
}

// ── Tool bar chart ────────────────────────────────────────────────────────────

const TOOL_COLORS = {
  exec:              'var(--yellow)',
  read:              'var(--blue)',
  edit:              'var(--accent)',
  grep:              'var(--purple)',
  write:             'var(--accent)',
  todo_write:        'var(--text-secondary)',
  get_output:        'var(--blue)',
  webfetch:          'var(--purple)',
  find_file_by_name: 'var(--blue)',
  mcp_call_tool:     'var(--yellow)',
}

const TOOL_TIP =
  'Total number of times Devin called each tool across all sessions ever recorded. ' +
  '"exec" runs shell commands, "read" reads files, "edit" rewrites file content, ' +
  '"grep" searches code, "mcp_call_tool" calls external MCP integrations, etc.'

function ToolBarChart({ tools }) {
  const [hover, setHover] = useState(null)
  if (!tools.length) return <div className="splash-empty-note">No tool data yet.</div>

  const maxCalls = tools[0].calls
  const BAR_H = 12
  const GAP = 5
  const LABEL_W = 100
  const COUNT_W = 44
  const BAR_AREA = 80
  const ROW_H = BAR_H + GAP
  const totalH = tools.length * ROW_H - GAP

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${LABEL_W + COUNT_W + BAR_AREA} ${totalH}`}
        style={{ width: '100%', height: `${totalH + 2}px`, display: 'block', overflow: 'visible' }}
      >
        {tools.map((t, i) => {
          const y = i * ROW_H
          const barW = Math.max(2, Math.round((t.calls / maxCalls) * BAR_AREA))
          const color = TOOL_COLORS[t.name] || 'var(--border-bright)'
          const isHov = hover === i
          return (
            <g key={t.name}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}>
              <text x={LABEL_W - 4} y={y + BAR_H * 0.78} textAnchor="end"
                fill={isHov ? color : 'var(--text-secondary)'}
                fontSize="9.5" fontFamily="var(--font-mono)">
                {t.name}
              </text>
              <text x={LABEL_W + COUNT_W - 2} y={y + BAR_H * 0.78} textAnchor="end"
                fill={isHov ? 'var(--text-secondary)' : 'var(--text-muted)'}
                fontSize="8.5" fontFamily="var(--font-mono)">
                {t.calls.toLocaleString()}
              </text>
              <rect x={LABEL_W + COUNT_W} y={y + 2} width={BAR_AREA} height={BAR_H - 4}
                rx={2} fill="var(--bg-elevated)" />
              <rect x={LABEL_W + COUNT_W} y={y + 2} width={barW} height={BAR_H - 4}
                rx={2} fill={color} opacity={isHov ? 1 : 0.7} />
            </g>
          )
        })}
      </svg>
      <div className="activity-chart-legend" style={{ marginTop: 4 }}>
        <span className="legend-label" style={{ color: 'var(--text-muted)' }}>
          cumulative calls · all sessions
        </span>
      </div>
    </div>
  )
}

// ── Project combo chart — grouped bars (duration + turns) with session count line ──

const COMBO_W = 420
const COMBO_H = 170
const COMBO_PAD_L = 36     // left axis labels
const COMBO_PAD_R = 36     // right axis labels
const COMBO_PAD_B = 28     // project name labels
const COMBO_PAD_T = 10     // top breathing room
const COMBO_PLOT_W = COMBO_W - COMBO_PAD_L - COMBO_PAD_R
const COMBO_PLOT_H = COMBO_H - COMBO_PAD_T - COMBO_PAD_B

function fmtDurationShort(sec) {
  if (sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function ProjectComboChart({ projects }) {
  const [hover, setHover] = useState(null)

  if (!projects.length) return <div className="splash-empty-note">No project data yet.</div>

  const maxMsg = Math.max(...projects.map(p => p.messages), 1)
  const maxDur = Math.max(...projects.map(p => p.durationSec), 1)
  const maxSess = Math.max(...projects.map(p => p.sessions), 1)

  const n = projects.length
  const groupW = COMBO_PLOT_W / n
  const barW = Math.min(16, groupW * 0.3)
  const barGap = Math.max(2, barW * 0.2)

  // Y-axis tick marks (left = duration, right = sessions)
  const durTicks = [0.25, 0.5, 0.75, 1]
  const sessTicks = []
  for (let s = 1; s <= maxSess; s++) sessTicks.push(s)
  // Limit to ~4 ticks for readability
  const sessTickStep = maxSess <= 4 ? 1 : Math.ceil(maxSess / 4)
  const sessTicksFiltered = sessTicks.filter(s => s % sessTickStep === 0 || s === maxSess)

  // Line points for session count
  const linePoints = projects.map((p, i) => {
    const cx = COMBO_PAD_L + groupW * i + groupW / 2
    const cy = COMBO_PAD_T + COMBO_PLOT_H - (p.sessions / maxSess) * COMBO_PLOT_H
    return { x: cx, y: cy, p }
  })
  const linePath = linePoints.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')

  return (
    <div className="activity-chart-wrap" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${COMBO_W} ${COMBO_H}`}
        className="activity-chart-svg"
        style={{ overflow: 'visible' }}
      >
        {/* Horizontal grid lines */}
        {durTicks.map(f => {
          const y = (COMBO_PAD_T + COMBO_PLOT_H - f * COMBO_PLOT_H).toFixed(1)
          return <line key={f} x1={COMBO_PAD_L} x2={COMBO_W - COMBO_PAD_R} y1={y} y2={y}
            stroke="var(--border)" strokeWidth="0.4" />
        })}

        {/* Left Y-axis labels (duration) */}
        {durTicks.map(f => {
          const y = COMBO_PAD_T + COMBO_PLOT_H - f * COMBO_PLOT_H
          return (
            <text key={f} x={COMBO_PAD_L - 4} y={y + 2.5} textAnchor="end"
              fill="var(--text-muted)" fontSize="6.5" fontFamily="var(--font-mono)">
              {fmtDurationShort(maxDur * f)}
            </text>
          )
        })}

        {/* Right Y-axis labels (sessions) */}
        {sessTicksFiltered.map(s => {
          const y = COMBO_PAD_T + COMBO_PLOT_H - (s / maxSess) * COMBO_PLOT_H
          return (
            <text key={s} x={COMBO_W - COMBO_PAD_R + 4} y={y + 2.5} textAnchor="start"
              fill="var(--yellow)" fontSize="6.5" fontFamily="var(--font-mono)" opacity="0.7">
              {s}
            </text>
          )
        })}

        {/* Grouped bars per project */}
        {projects.map((p, i) => {
          const cx = COMBO_PAD_L + groupW * i + groupW / 2
          const durH = (p.durationSec / maxDur) * COMBO_PLOT_H
          const msgH = (p.messages / maxMsg) * COMBO_PLOT_H
          const baseY = COMBO_PAD_T + COMBO_PLOT_H

          const durX = cx - barW - barGap / 2
          const msgX = cx + barGap / 2

          const isHov = hover === i
          return (
            <g key={p.name}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}>
              {/* Hit area */}
              <rect x={COMBO_PAD_L + groupW * i} y={COMBO_PAD_T}
                width={groupW} height={COMBO_PLOT_H + COMBO_PAD_B}
                fill="transparent" />

              {/* Duration bar */}
              <rect x={durX} y={baseY - Math.max(1, durH)} width={barW} height={Math.max(1, durH)}
                rx={2} fill="var(--cyan)" opacity={isHov ? 1 : 0.7} />

              {/* Turns bar */}
              <rect x={msgX} y={baseY - Math.max(1, msgH)} width={barW} height={Math.max(1, msgH)}
                rx={2} fill="var(--purple)" opacity={isHov ? 1 : 0.7} />

              {/* Project label */}
              <text x={cx} y={COMBO_H - 4} textAnchor="middle"
                fill={isHov ? 'var(--text-primary)' : 'var(--text-muted)'}
                fontSize="7.5" fontFamily="var(--font-mono)">
                {p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name}
              </text>
            </g>
          )
        })}

        {/* Session count line */}
        <polyline points={linePath} fill="none" stroke="var(--yellow)"
          strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
        {linePoints.map((pt, i) => (
          <circle key={i} cx={pt.x} cy={pt.y} r={hover === i ? 3.5 : 2.5}
            fill="var(--yellow)" opacity={hover === i ? 1 : 0.6} />
        ))}

        {/* Hover tooltip */}
        {hover !== null && (() => {
          const p = projects[hover]
          const cx = COMBO_PAD_L + groupW * hover + groupW / 2
          const tipW = 140
          const tipH = 34
          const tipX = Math.max(2, Math.min(cx - tipW / 2, COMBO_W - tipW - 2))
          const tipY = 2
          return (
            <>
              <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={3}
                fill="var(--bg-elevated)" stroke="var(--border-bright)" strokeWidth="0.8" />
              <text x={tipX + tipW / 2} y={tipY + 12} textAnchor="middle"
                fill="var(--text-primary)" fontSize="8" fontFamily="var(--font-mono)" fontWeight="600">
                {p.name}
              </text>
              <text x={tipX + tipW / 2} y={tipY + 24} textAnchor="middle"
                fill="var(--text-secondary)" fontSize="7" fontFamily="var(--font-mono)">
                {fmtDurationShort(p.durationSec)} · {p.messages.toLocaleString()} turns · {p.sessions} sess
              </text>
            </>
          )
        })()}
      </svg>

      {/* Legend */}
      <div className="activity-chart-legend" style={{ marginTop: 2 }}>
        <span className="legend-dot" style={{ background: 'var(--cyan)' }} />
        <span className="legend-label">duration</span>
        <span className="legend-dot" style={{ background: 'var(--purple)', marginLeft: 8 }} />
        <span className="legend-label">turns</span>
        <span className="legend-dot" style={{ background: 'var(--yellow)', marginLeft: 8 }} />
        <span className="legend-label">sessions (right axis)</span>
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, tip, children }) {
  return (
    <div className="splash-section">
      <div className="splash-section-title">
        {title}
        {tip && <InfoTip text={tip} />}
      </div>
      {children}
    </div>
  )
}

// ── Model usage ───────────────────────────────────────────────────────────────

function fmtTokens(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)         return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

function friendlyModel(raw) {
  return raw
    .replace('MODEL_PRIVATE_2',       'Private Preview')
    .replace('MODEL_CLAUDE_4_SONNET', 'Sonnet 4 (early)')
    .replace('claude-sonnet-4-6-thinking', 'Sonnet 4.6 ✦')
    .replace('claude-opus-4-6-thinking',   'Opus 4.6 ✦')
    .replace('claude-sonnet-4-6',          'Sonnet 4.6')
    .replace('claude-opus-4-6',            'Opus 4.6')
}

/**
 * ModelUsageTable — shows real per-model token consumption.
 *
 * Primary metric: output tokens (proxy for "how much the model did").
 * Bar: stacked output / input / cache_write / cache_read — each bucket
 *      drawn proportionally so the relative cost structure is visible.
 * Numbers: output tokens headline, calls secondary.
 */
function ModelUsageTable({ models }) {
  const [hovered, setHovered] = useState(null)

  if (!models || models.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No token data yet.</div>
  }

  // Scale bars by output tokens — the "work done" axis
  const maxOutput = models[0]?.outputTokens || 1

  return (
    <div className="model-usage-table">
      {models.map(m => {
        const total = m.inputTokens + m.outputTokens + m.cacheWriteTokens + m.cacheReadTokens
        // Each bar segment as % of output-max (so all bars are relative to top model)
        const outPct   = Math.max(2, (m.outputTokens     / maxOutput) * 100)
        const inPct    = (m.inputTokens      / maxOutput) * 100
        const cwPct    = (m.cacheWriteTokens / maxOutput) * 100
        const crPct    = (m.cacheReadTokens  / maxOutput) * 8  // scale down — very large, less costly

        const isHov = hovered === m.model
        return (
          <div
            key={m.model}
            className="model-usage-row"
            onMouseEnter={() => setHovered(m.model)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="model-usage-header">
              <span className="model-usage-name" style={{ color: MODEL_COLORS[m.model] || 'var(--text-secondary)' }}>
                {friendlyModel(m.model)}
              </span>
              <span className="model-usage-out">
                {fmtTokens(m.outputTokens)} out
              </span>
              <span className="model-usage-calls">
                {m.calls.toLocaleString()} calls
              </span>
            </div>

            {/* Stacked bar: output | input | cache_write | cache_read */}
            <div className="model-usage-bar-track" title={
              `Output: ${m.outputTokens.toLocaleString()}\n` +
              `Input: ${m.inputTokens.toLocaleString()}\n` +
              `Cache write: ${m.cacheWriteTokens.toLocaleString()}\n` +
              `Cache read: ${m.cacheReadTokens.toLocaleString()}\n` +
              `Total API calls: ${m.calls.toLocaleString()}`
            }>
              <div className="model-bar-seg model-bar-output"   style={{ width: outPct + '%' }} />
              <div className="model-bar-seg model-bar-input"    style={{ width: inPct  + '%' }} />
              <div className="model-bar-seg model-bar-cwrite"   style={{ width: cwPct  + '%' }} />
              <div className="model-bar-seg model-bar-cread"    style={{ width: crPct  + '%' }} />
            </div>

            {/* Expanded detail on hover */}
            {isHov && (
              <div className="model-usage-detail">
                <span><span className="model-detail-dot model-bar-output" />Output <b>{m.outputTokens.toLocaleString()}</b></span>
                <span><span className="model-detail-dot model-bar-input" />Input <b>{m.inputTokens.toLocaleString()}</b></span>
                <span><span className="model-detail-dot model-bar-cwrite" />Cache write <b>{m.cacheWriteTokens.toLocaleString()}</b></span>
                <span><span className="model-detail-dot model-bar-cread" />Cache read <b>{m.cacheReadTokens.toLocaleString()}</b></span>
              </div>
            )}
          </div>
        )
      })}

      {/* Legend */}
      <div className="model-usage-legend">
        <span><span className="model-detail-dot model-bar-output" />output</span>
        <span><span className="model-detail-dot model-bar-input" />input</span>
        <span><span className="model-detail-dot model-bar-cwrite" />cache write</span>
        <span><span className="model-detail-dot model-bar-cread" />cache read</span>
      </div>
    </div>
  )
}

const MODEL_COLORS = {
  'claude-sonnet-4-6-thinking': 'var(--blue)',
  'claude-opus-4-6-thinking':   'var(--purple)',
  'claude-opus-4-6':            'var(--accent)',
  'claude-sonnet-4-6':          '#4db8ff',
  'MODEL_PRIVATE_2':            'var(--yellow)',
  'MODEL_CLAUDE_4_SONNET':      '#7ab8ff',
}

const MODEL_TIP =
  'Real token consumption per model, read from each API call recorded in your ' +
  'local sessions database. Output = tokens generated. Input = fresh context. ' +
  'Cache write = prompt cache creation (1.25× input rate). ' +
  'Cache read = cache hits (0.1× input rate). Hover a row for exact counts.'

const PROJECT_TIP =
  'Breakdown by working directory (folder name). Duration bars (cyan) show total wall-clock ' +
  'time across all sessions. Turns bars (purple) show total AI message nodes. The yellow line ' +
  'tracks session count per project (right axis). Hover a project for exact numbers.'

// ── Main component ────────────────────────────────────────────────────────────

export default function DashboardSplash({ connected, latestPrompt }) {
  const { stats, error } = useStats()

  if (!connected) return (
    <div className="splash-loading"><div className="spinner" />Connecting…</div>
  )
  if (error) return (
    <div className="splash-loading" style={{ color: 'var(--red)' }}>Stats error: {error}</div>
  )
  if (!stats) return (
    <div className="splash-loading"><div className="spinner" />Loading…</div>
  )

  const { projects, tools, activityByHour, models } = stats

  return (
    <div className="splash">
      <LatestPromptBanner prompt={latestPrompt} />
      <div className="splash-body">

        {/* ── Left column ──────────────────────────────────────────── */}
        <div className="splash-col">

          <Section title="AI Activity by Hour" tip={ACTIVITY_TIP}>
            <ActivityChart data={activityByHour} />
          </Section>

          <Section title="Projects" tip={PROJECT_TIP}>
            <ProjectComboChart projects={projects} />
          </Section>

        </div>

        {/* ── Right column ─────────────────────────────────────────── */}
        <div className="splash-col">

          <Section title="Tool Calls" tip={TOOL_TIP}>
            <ToolBarChart tools={tools} />
          </Section>

          <Section title="Model Token Usage" tip={MODEL_TIP}>
            <ModelUsageTable models={models} />
          </Section>

        </div>
      </div>
    </div>
  )
}

/**
 * DashboardSplash — shown in the main area when no session is selected.
 *
 * Panels:
 *   - Activity summary (24h / 48h / 72h / older buckets)
 *   - Sessions created per day (14-day sparkline)
 *   - Project breakdown (sessions + messages per repo)
 *   - Activity by hour heatmap (last 7 days)
 *   - Tool leaderboard
 *   - Model usage
 *   - MCP servers
 *   - Skills
 *   - Plugins
 *   - Recent prompts
 */

import { useEffect, useState } from 'react'

function useStats() {
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

/** Mini bar — width as % of max */
function Bar({ value, max, color = 'var(--accent)' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="splash-bar-track">
      <div className="splash-bar-fill" style={{ width: pct + '%', background: color }} />
    </div>
  )
}

/** Tiny sparkline for sessions-per-day */
function Sparkline({ data }) {
  const values = Object.values(data)
  const max = Math.max(...values, 1)
  const labels = Object.keys(data)
  return (
    <div className="sparkline">
      {values.map((v, i) => (
        <div key={i} className="sparkline-col" title={`${labels[i]}: ${v} session${v !== 1 ? 's' : ''}`}>
          <div
            className="sparkline-bar"
            style={{ height: Math.max(2, Math.round((v / max) * 40)) + 'px', opacity: v > 0 ? 1 : 0.15 }}
          />
        </div>
      ))}
    </div>
  )
}

/** 24-slot hour heatmap */
function HourHeatmap({ data }) {
  const max = Math.max(...data, 1)
  const hours = data.map((v, i) => {
    const intensity = v / max
    const bg = intensity === 0
      ? 'var(--bg-elevated)'
      : `rgba(0, 255, 163, ${0.08 + intensity * 0.85})`
    const label = i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`
    return { v, bg, label }
  })
  return (
    <div className="hour-heatmap">
      {hours.map((h, i) => (
        <div key={i} className="hour-cell" style={{ background: h.bg }} title={`${h.label}: ${h.v.toLocaleString()} events`}>
          <span className="hour-label">{h.label}</span>
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="splash-stat-card">
      <div className="splash-stat-value" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
      <div className="splash-stat-label">{label}</div>
      {sub && <div className="splash-stat-sub">{sub}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="splash-section">
      <div className="splash-section-title">{title}</div>
      {children}
    </div>
  )
}

const MODEL_COLORS = {
  'claude-sonnet-4-6-thinking': 'var(--blue)',
  'claude-opus-4-6-thinking':   'var(--purple)',
  'claude-opus-4-6':            'var(--accent)',
  'claude-sonnet-4-6':          'var(--blue)',
  'MODEL_PRIVATE_2':            'var(--yellow)',
  'MODEL_CLAUDE_4_SONNET':      'var(--blue)',
}

const TOOL_COLORS = {
  exec:           'var(--yellow)',
  read:           'var(--blue)',
  edit:           'var(--accent)',
  grep:           'var(--purple)',
  write:          'var(--accent)',
  todo_write:     'var(--text-secondary)',
  get_output:     'var(--blue)',
  webfetch:       'var(--purple)',
  find_file_by_name: 'var(--blue)',
  mcp_call_tool:  'var(--yellow)',
}

function relTime(ts) {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function DashboardSplash({ sessions, connected }) {
  const { stats, error } = useStats()

  if (!connected) {
    return (
      <div className="splash-loading">
        <div className="spinner" />
        Connecting…
      </div>
    )
  }

  if (error) {
    return <div className="splash-loading" style={{ color: 'var(--red)' }}>Failed to load stats: {error}</div>
  }

  if (!stats) {
    return (
      <div className="splash-loading">
        <div className="spinner" />
        Loading dashboard…
      </div>
    )
  }

  const { activity, sessionsByDay, projects, tools, activityByHour, models, recentPrompts, mcpServers, skills, plugins, model } = stats
  const toolMax = tools[0]?.calls || 1
  const projMax = projects[0]?.messages || 1
  const modelMax = models[0]?.sessions || 1

  return (
    <div className="splash">
      {/* ── Top stat row ─────────────────────────────────────────────── */}
      <div className="splash-stat-row">
        <StatCard label="Active 24h"  value={activity.h24}    color="var(--accent)" />
        <StatCard label="Active 48h"  value={activity.h48}    color="var(--blue)" />
        <StatCard label="Active 72h"  value={activity.h72}    color="var(--text-secondary)" />
        <StatCard label="Older"       value={activity.older}  color="var(--text-muted)" />
        <StatCard label="Projects"    value={projects.length} color="var(--purple)" />
        <StatCard label="Total Sessions" value={activity.total} />
        {model && <StatCard label="Default Model" value={model.replace('claude-', '').replace('-thinking', ' ✦')} color="var(--yellow)" />}
      </div>

      <div className="splash-body">
        {/* ── Left column ──────────────────────────────────────────────── */}
        <div className="splash-col">

          {/* Sessions per day */}
          <Section title="Sessions Created · Last 14 Days">
            <Sparkline data={sessionsByDay} />
            <div className="splash-spark-labels">
              <span>{Object.keys(sessionsByDay)[0]?.slice(5)}</span>
              <span>{Object.keys(sessionsByDay)[13]?.slice(5)}</span>
            </div>
          </Section>

          {/* Activity by hour */}
          <Section title="Activity by Hour · Last 7 Days">
            <HourHeatmap data={activityByHour} />
            <div className="splash-heat-sub">message events · local time</div>
          </Section>

          {/* Project breakdown */}
          <Section title="Projects">
            {projects.map(p => (
              <div key={p.name} className="splash-row">
                <span className="splash-row-label">{p.name}</span>
                <span className="splash-row-count">{p.sessions}s · {p.messages.toLocaleString()} msgs</span>
                <Bar value={p.messages} max={projMax} color="var(--purple)" />
              </div>
            ))}
          </Section>

          {/* Model usage */}
          <Section title="Models Used">
            {models.map(m => (
              <div key={m.model} className="splash-row">
                <span className="splash-row-label" style={{ color: MODEL_COLORS[m.model] || 'var(--text-secondary)' }}>
                  {m.model.replace('MODEL_PRIVATE_2', 'Private Preview').replace('MODEL_CLAUDE_4_SONNET', 'Sonnet 4')}
                </span>
                <span className="splash-row-count">{m.sessions} session{m.sessions !== 1 ? 's' : ''}</span>
                <Bar value={m.sessions} max={modelMax} color={MODEL_COLORS[m.model] || 'var(--text-secondary)'} />
              </div>
            ))}
          </Section>

        </div>

        {/* ── Right column ─────────────────────────────────────────────── */}
        <div className="splash-col">

          {/* Tool leaderboard */}
          <Section title="Tool Leaderboard · All Sessions">
            {tools.map(t => (
              <div key={t.name} className="splash-row">
                <span className="splash-row-label" style={{ fontFamily: 'var(--font-mono)', color: TOOL_COLORS[t.name] || 'var(--text-secondary)' }}>
                  {t.name}
                </span>
                <span className="splash-row-count">{t.calls.toLocaleString()}</span>
                <Bar value={t.calls} max={toolMax} color={TOOL_COLORS[t.name] || 'var(--border-bright)'} />
              </div>
            ))}
          </Section>

          {/* Recent prompts */}
          <Section title="Recent Prompts">
            {recentPrompts.map((p, i) => (
              <div key={i} className="splash-prompt-row">
                <span className="splash-prompt-time">{relTime(p.timestamp)}</span>
                <span className="splash-prompt-text">{p.content.slice(0, 100)}{p.content.length > 100 ? '…' : ''}</span>
              </div>
            ))}
          </Section>

          {/* MCP Servers */}
          <Section title={`MCP Servers · ${mcpServers.length} configured`}>
            {mcpServers.length === 0
              ? <div className="splash-empty-note">None configured</div>
              : mcpServers.map(s => (
                  <div key={s.name} className="splash-chip-row">
                    <span className="splash-chip splash-chip-mcp">{s.name}</span>
                    <span className="splash-chip-meta">{s.type}{s.url ? ` · ${new URL(s.url).hostname}` : ''}</span>
                  </div>
                ))
            }
          </Section>

          {/* Skills */}
          <Section title={`Skills · ${skills.length} installed`}>
            {skills.length === 0
              ? <div className="splash-empty-note">No skills found</div>
              : skills.map(s => (
                  <div key={s.name} className="splash-chip-row">
                    <span className="splash-chip splash-chip-skill">/{s.name}</span>
                    {s.description && (
                      <span className="splash-chip-meta" title={s.description}>
                        {s.description.slice(0, 60)}{s.description.length > 60 ? '…' : ''}
                      </span>
                    )}
                  </div>
                ))
            }
          </Section>

          {/* Plugins */}
          {plugins.length > 0 && (
            <Section title={`Plugins · ${plugins.length} configured`}>
              {plugins.map(p => (
                <div key={p.name} className="splash-chip-row">
                  <span className={`splash-chip ${p.missing ? 'splash-chip-missing' : 'splash-chip-plugin'}`}>{p.name}</span>
                  {p.missing
                    ? <span className="splash-chip-meta" style={{ color: 'var(--red)' }}>path not found</span>
                    : p.description
                      ? <span className="splash-chip-meta">{p.description.slice(0, 60)}</span>
                      : null
                  }
                </div>
              ))}
            </Section>
          )}

        </div>
      </div>
    </div>
  )
}

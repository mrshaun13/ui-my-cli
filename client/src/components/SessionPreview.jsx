/**
 * SessionPreview — read-only session detail panel.
 *
 * Shown when you click the status icon on a session card.
 * No PTY is spawned — pure DB data, zero impact on last_activity_at.
 *
 * Layout:
 *   Header: title · project · status · model · permission mode
 *   Stats row: created · duration · messages · tool calls · compactions · peak ctx
 *   Top tools mini-bar chart
 *   Chat thread: last 3-5 user→assistant exchanges, styled as bubbles
 *   Footer: Archive button (left) · Resume button (right)
 */

import { useEffect, useState } from 'react'

const STATUS_LABEL = {
  needs_you: 'Needs your input',
  running:   'Running',
  thinking:  'Thinking',
  idle:      'Idle',
  archived:  'Archived',
}

const STATUS_COLOR = {
  needs_you: 'var(--yellow)',
  running:   'var(--blue)',
  thinking:  'var(--purple)',
  idle:      'var(--text-muted)',
  archived:  'var(--text-muted)',
}

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
  run_subagent:      'var(--purple)',
  read_subagent:     'var(--purple)',
}

function formatTokens(n) {
  if (!n) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

function StatPill({ label, value, highlight }) {
  return (
    <div className="preview-stat">
      <span className="preview-stat-value" style={highlight ? { color: highlight } : undefined}>
        {value}
      </span>
      <span className="preview-stat-label">{label}</span>
    </div>
  )
}

function ToolMiniBar({ tools }) {
  if (!tools?.length) return null
  const max = tools[0].count
  return (
    <div className="preview-tools">
      {tools.map(t => (
        <div key={t.name} className="preview-tool-row">
          <span className="preview-tool-name" style={{ color: TOOL_COLORS[t.name] || 'var(--text-secondary)' }}>
            {t.name}
          </span>
          <div className="preview-tool-track">
            <div
              className="preview-tool-fill"
              style={{
                width: `${Math.round((t.count / max) * 100)}%`,
                background: TOOL_COLORS[t.name] || 'var(--border-bright)',
              }}
            />
          </div>
          <span className="preview-tool-count">{t.count}</span>
        </div>
      ))}
    </div>
  )
}

function ChatBubble({ turn, index, total }) {
  const [expanded, setExpanded] = useState(false)
  const isLatest = index === total - 1

  const USER_LIMIT   = 220
  const ASSIST_LIMIT = 320

  const userTrunc   = turn.userText.length > USER_LIMIT
  const assistTrunc = turn.assistantText && turn.assistantText.length > ASSIST_LIMIT

  const userDisplay   = expanded || !userTrunc   ? turn.userText   : turn.userText.slice(0, USER_LIMIT) + '…'
  const assistDisplay = expanded || !assistTrunc
    ? turn.assistantText
    : turn.assistantText?.slice(0, ASSIST_LIMIT) + '…'

  const canExpand = userTrunc || assistTrunc

  return (
    <div className={`preview-turn${isLatest ? ' preview-turn-latest' : ''}`}>
      {/* User bubble */}
      <div className="preview-bubble preview-bubble-user">
        <span className="preview-bubble-label">you</span>
        <p className="preview-bubble-text">{userDisplay}</p>
      </div>

      {/* Assistant bubble */}
      {assistDisplay ? (
        <div className="preview-bubble preview-bubble-assistant">
          <span className="preview-bubble-label">devin</span>
          <p className="preview-bubble-text">{assistDisplay}</p>
        </div>
      ) : (
        <div className="preview-bubble preview-bubble-assistant preview-bubble-dim">
          <span className="preview-bubble-label">devin</span>
          <p className="preview-bubble-text" style={{ fontStyle: 'italic', opacity: 0.4 }}>
            (tool calls only — no text response)
          </p>
        </div>
      )}

      {canExpand && (
        <button className="preview-expand-btn" onClick={() => setExpanded(v => !v)}>
          {expanded ? '▲ collapse' : '▼ show full'}
        </button>
      )}

      {/* Separator between turns (not after last) */}
      {!isLatest && <div className="preview-turn-sep" />}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SessionPreview({ sessionId, onResume, onArchive }) {
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!sessionId) return
    setData(null)
    setError(null)
    fetch(`/api/sessions/${sessionId}/preview`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => setError(e.message))
  }, [sessionId])

  if (error) return (
    <div className="preview-wrap preview-loading" style={{ color: 'var(--red)' }}>
      Error loading preview: {error}
    </div>
  )

  if (!data) return (
    <div className="preview-wrap preview-loading">
      <div className="spinner" /> Loading session…
    </div>
  )

  const statusColor = STATUS_COLOR[data.status] || 'var(--text-muted)'
  const statusLabel = STATUS_LABEL[data.status] || data.status

  return (
    <div className="preview-wrap">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="preview-header">
        <div className="preview-header-top">
          <div className="preview-title-group">
            <span className="preview-title">{data.alias || data.title}</span>
            {data.alias && data.alias !== data.title && (
              <span className="preview-subtitle">{data.title}</span>
            )}
          </div>
          <div className="preview-badges">
            <span className="preview-badge" style={{ color: statusColor, borderColor: statusColor, background: `color-mix(in srgb, ${statusColor} 10%, transparent)` }}>
              {statusLabel}
            </span>
            <span className="preview-badge preview-badge-model">
              {data.model?.replace('claude-', '').replace('MODEL_CLAUDE_4_SONNET', 'Sonnet 4').replace('MODEL_PRIVATE_2', 'Preview') || 'unknown'}
            </span>
            <span className="preview-badge preview-badge-dim">
              {data.backendType}
            </span>
          </div>
        </div>

        <div className="preview-path">
          <code>{data.id.slice(0, 8)}</code>
          <span className="preview-path-sep">·</span>
          {data.workingDir}
        </div>
      </div>

      {/* ── Stats row ───────────────────────────────────────────────── */}
      <div className="preview-stats-row">
        <StatPill label="created"    value={data.createdAtStr} />
        <StatPill label="duration"   value={data.durationStr} />
        <StatPill label="last active" value={data.lastActivityAgo} />
        <StatPill label="user msgs"  value={data.userMsgCount} />
        <StatPill label="tool calls" value={data.toolCallCount.toLocaleString()} />
        <StatPill label="compactions" value={data.compactionCount}
          highlight={data.compactionCount > 5 ? 'var(--yellow)' : undefined} />
        <StatPill label="peak ctx"
          value={formatTokens(data.peakContextTokens)}
          highlight={data.peakContextTokens > 100000 ? 'var(--yellow)' : undefined} />
        <StatPill label="nodes" value={data.totalNodes.toLocaleString()} />
      </div>

      {/* ── Two-column body ─────────────────────────────────────────── */}
      <div className="preview-body">

        {/* Left: chat thread */}
        <div className="preview-thread-col">
          <div className="preview-section-label">Last {data.chatThread.length} exchanges</div>
          {data.chatThread.length === 0 ? (
            <div className="preview-empty">No conversation history found.</div>
          ) : (
            data.chatThread.map((turn, i) => (
              <ChatBubble
                key={i}
                turn={turn}
                index={i}
                total={data.chatThread.length}
              />
            ))
          )}
        </div>

        {/* Right: tool breakdown */}
        <div className="preview-tools-col">
          <div className="preview-section-label">Tool breakdown</div>
          <ToolMiniBar tools={data.topTools} />
          <div className="preview-section-label" style={{ marginTop: 14 }}>Session info</div>
          <div className="preview-info-rows">
            <div className="preview-info-row">
              <span className="preview-info-key">permission</span>
              <span className="preview-info-val">{data.permissionMode}</span>
            </div>
            <div className="preview-info-row">
              <span className="preview-info-key">backend</span>
              <span className="preview-info-val">{data.backendType}</span>
            </div>
            <div className="preview-info-row">
              <span className="preview-info-key">project</span>
              <span className="preview-info-val">{data.project}</span>
            </div>
            <div className="preview-info-row">
              <span className="preview-info-key">assistant msgs</span>
              <span className="preview-info-val">{data.assistantMsgCount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer actions ───────────────────────────────────────────── */}
      <div className="preview-footer">
        <button
          className="btn preview-btn-archive"
          onClick={() => onArchive(data.id)}
          title="Archive this session (reversible)"
        >
          ⊘ Archive
        </button>
        <button
          className="btn btn-primary preview-btn-resume"
          onClick={() => onResume(data.id)}
          title="Open live terminal for this session"
        >
          ▶ Resume session
        </button>
      </div>

    </div>
  )
}

/**
 * SessionPreview — read-only session detail panel.
 *
 * Shown when you click the status icon on a session card.
 * No PTY is spawned — pure DB data, zero impact on last_activity_at.
 *
 * Layout:
 *   Header: title · project · status · model · permission mode
 *   Stats row: created · duration · messages · tool calls · compactions · peak ctx
 *   Top tools mini-bar chart + Model usage section
 *   Chat thread: last 3-5 user→assistant exchanges, styled as bubbles
 *   Footer: Archive button (left) · Resume button (right)
 */

import { useEffect, useRef, useState } from 'react'

const STATUS_LABEL = {
  question: 'Needs your input',
  active:   'Running',
  finished: 'Finished',
  idle:     'Idle',
  archived: 'Archived',
}

const STATUS_COLOR = {
  question: 'var(--yellow)',
  active:   'var(--blue)',
  finished: 'var(--accent)',
  idle:     'var(--text-muted)',
  archived: 'var(--text-muted)',
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

// Friendly display names for model strings
function friendlyModel(raw) {
  if (!raw) return 'unknown'
  return raw
    .replace('claude-', '')
    .replace('MODEL_PRIVATE_2', 'sonnet-4-6-thinking (preview)')
    .replace('MODEL_SWE_1_5_SLOW', 'swe-1.5')
    .replace('MODEL_CLAUDE_4_SONNET', 'sonnet-4')
    .replace(/-(\d)/g, ' $1')         // "sonnet 4 6" spacing
    .replace(/\s+/g, ' ')
    .trim()
}

// Model family → color
function modelColor(raw) {
  if (!raw) return 'var(--text-muted)'
  const m = raw.toLowerCase()
  if (m.includes('opus'))    return 'var(--purple)'
  if (m.includes('sonnet'))  return 'var(--accent)'
  if (m.includes('haiku'))   return 'var(--blue)'
  if (m.includes('swe'))     return 'var(--yellow)'
  return 'var(--text-secondary)'
}

function formatTokens(n) {
  if (!n) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

// ── Info bubble (tooltip) ─────────────────────────────────────────────────────
function InfoBubble({ tip }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <span className="info-bubble-wrap" ref={ref}>
      <button
        className="info-bubble-btn"
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        title={tip}
        aria-label="More info"
      >ⓘ</button>
      {open && (
        <div className="info-bubble-tip">{tip}</div>
      )}
    </span>
  )
}

// ── Stat pill with optional info bubble ──────────────────────────────────────
function StatPill({ label, value, highlight, tip }) {
  return (
    <div className="preview-stat">
      <span className="preview-stat-value" style={highlight ? { color: highlight } : undefined}>
        {value}
      </span>
      <span className="preview-stat-label">
        {label}
        {tip && <InfoBubble tip={tip} />}
      </span>
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

// ── Model usage section ───────────────────────────────────────────────────────
function ModelSection({ startingModel, currentModel, modelSwitches }) {
  const modelChanged = startingModel !== currentModel

  // Build a deduplicated list of all models touched in this session
  // Order: startingModel first, then any switch targets, deduped
  const allModels = [startingModel]
  for (const sw of (modelSwitches || [])) {
    if (sw.model && !allModels.includes(sw.model)) allModels.push(sw.model)
  }
  if (currentModel && !allModels.includes(currentModel)) allModels.push(currentModel)

  const multiModel = allModels.length > 1

  return (
    <div className="preview-model-section">
      <div className="preview-section-label" style={{ marginTop: 14 }}>
        Model usage
        <InfoBubble tip="The LLM(s) used in this session. Sessions can switch models mid-conversation with /model. 'Starting' is when the session was created; 'Current' is what's active now." />
      </div>

      {/* Current model chip */}
      <div className="preview-model-row">
        <span
          className="preview-model-chip"
          style={{ color: modelColor(currentModel), borderColor: modelColor(currentModel), background: `color-mix(in srgb, ${modelColor(currentModel)} 12%, transparent)` }}
        >
          {friendlyModel(currentModel)}
        </span>
        {modelChanged && (
          <span className="preview-model-note">current</span>
        )}
      </div>

      {/* Starting model (if different) */}
      {modelChanged && (
        <div className="preview-model-row" style={{ marginTop: 4 }}>
          <span
            className="preview-model-chip preview-model-chip-dim"
            style={{ color: modelColor(startingModel), borderColor: modelColor(startingModel) }}
          >
            {friendlyModel(startingModel)}
          </span>
          <span className="preview-model-note">started on</span>
        </div>
      )}

      {/* Switch timeline */}
      {multiModel && modelSwitches?.length > 0 && (
        <div className="preview-model-switches">
          <div className="preview-model-switches-label">
            {modelSwitches.length} model switch{modelSwitches.length !== 1 ? 'es' : ''} during session
          </div>
          {modelSwitches.map((sw, i) => (
            <div key={i} className="preview-model-switch-row">
              <span className="preview-model-switch-dot" style={{ background: modelColor(sw.model) }} />
              <span className="preview-model-switch-name">{friendlyModel(sw.model)}</span>
            </div>
          ))}
        </div>
      )}
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

export default function SessionPreview({ sessionId, onResume, onArchive, onRename }) {
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!sessionId) return
    setData(null)
    setError(null)
    setRenaming(false)
    fetch(`/api/sessions/${sessionId}/preview`)
      .then(r => r.json())
      .then(d => { setData(d); setNameValue(d.title) })
      .catch(e => setError(e.message))
  }, [sessionId])

  // Auto-select text when input appears
  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  const startRename = (e) => {
    e?.stopPropagation()
    setNameValue(data?.title || '')
    setRenaming(true)
  }

  const commitRename = () => {
    setRenaming(false)
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== data?.title) {
      onRename && onRename(data.id, trimmed)
      setData(prev => prev ? { ...prev, title: trimmed } : prev)
    }
  }

  const onTitleKeyDown = (e) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') { setRenaming(false); setNameValue(data?.title || '') }
    e.stopPropagation()
  }

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
            {renaming ? (
              <input
                ref={inputRef}
                className="preview-rename-input"
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={onTitleKeyDown}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span
                className="preview-title"
                onDoubleClick={startRename}
                title="Double-click to rename"
              >
                {data.title}
                <button
                  className="preview-rename-btn"
                  onClick={startRename}
                  title="Rename session"
                  tabIndex={0}
                >✎</button>
              </span>
            )}
          </div>
          <div className="preview-badges">
            <span className="preview-badge" style={{ color: statusColor, borderColor: statusColor, background: `color-mix(in srgb, ${statusColor} 10%, transparent)` }}>
              {statusLabel}
            </span>
            <span
              className="preview-badge preview-badge-model"
              style={{ color: modelColor(data.currentModel), borderColor: `color-mix(in srgb, ${modelColor(data.currentModel)} 40%, transparent)` }}
            >
              {friendlyModel(data.currentModel)}
            </span>
            {data.startingModel !== data.currentModel && (
              <span className="preview-badge preview-badge-dim" title={`Started on: ${friendlyModel(data.startingModel)}`}>
                ⇄ switched
              </span>
            )}
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
        <StatPill
          label="user msgs"
          value={data.userMsgCount}
          tip="Number of messages you sent to Devin in this session."
        />
        <StatPill
          label="tool calls"
          value={data.toolCallCount.toLocaleString()}
          tip="Total number of tool invocations Devin made — exec, read, edit, grep, web fetch, etc. Higher counts mean more autonomous work."
        />
        <StatPill
          label="compactions"
          value={data.compactionCount}
          highlight={data.compactionCount > 5 ? 'var(--yellow)' : undefined}
          tip="Context compactions happen when the conversation history gets too long. Devin summarizes earlier turns to free up context window space. Frequent compactions may indicate a very long or complex session."
        />
        <StatPill
          label="peak ctx"
          value={formatTokens(data.peakContextTokens)}
          highlight={data.peakContextTokens > 100000 ? 'var(--yellow)' : undefined}
          tip="The highest token count recorded in the context window during this session. Yellow = exceeded 100k tokens. Context limits vary by model — approaching the limit triggers compaction."
        />
        <StatPill
          label="nodes"
          value={data.totalNodes.toLocaleString()}
          tip="Total message nodes stored in the database for this session. Each user message, assistant response, tool call, and tool result is a separate node."
        />
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

        {/* Right: tool breakdown + model section + session info */}
        <div className="preview-tools-col">
          <div className="preview-section-label">
            Tool breakdown
            <InfoBubble tip="How often Devin used each tool in this session. Tools let Devin interact with your system — run commands, read/edit files, search code, browse the web, and more." />
          </div>
          <ToolMiniBar tools={data.topTools} />

          <ModelSection
            startingModel={data.startingModel}
            currentModel={data.currentModel}
            modelSwitches={data.modelSwitches}
          />

          <div className="preview-section-label" style={{ marginTop: 14 }}>Session info</div>
          <div className="preview-info-rows">
            <div className="preview-info-row">
              <span className="preview-info-key">
                permission
                <InfoBubble tip="Permission mode controls how freely Devin can act without asking you first. 'cautious' asks before most actions; 'normal' asks for risky operations; 'yolo' runs autonomously." />
              </span>
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

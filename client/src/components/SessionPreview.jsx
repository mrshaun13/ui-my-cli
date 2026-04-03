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

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import SubagentTimeline from './SubagentTimeline'

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

// ── Info tooltip (hover) ──────────────────────────────────────────────────────
// Matches the Dashboard InfoTip — hover to show, portal-rendered to escape overflow.
function InfoBubble({ tip }) {
  const [show, setShow] = useState(false)
  const iconRef = useRef(null)
  const tipRef = useRef(null)
  const [pos, setPos] = useState(null)

  useEffect(() => {
    if (!show || !iconRef.current) return

    function reposition() {
      const r = iconRef.current.getBoundingClientRect()
      const tipEl = tipRef.current
      const tipH = tipEl ? tipEl.offsetHeight : 60
      const tipW = tipEl ? tipEl.offsetWidth : 260

      // Prefer above; flip below if not enough room
      const above = r.top - tipH - 6 >= 0
      const top = above ? r.top - tipH - 6 : r.bottom + 6
      let left = r.left + r.width / 2 - tipW / 2
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8))

      setPos({ top, left })
    }

    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [show])

  return (
    <span className="info-tip-wrap"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      ref={iconRef}>
      <span className="info-tip-icon">ⓘ</span>
      {show && createPortal(
        <span
          ref={tipRef}
          className="info-tip-bubble info-tip-bubble-portal"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
        >{tip}</span>,
        document.body
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

function formatTurnTime(epochSec) {
  if (!epochSec) return null
  const d = new Date(epochSec * 1000)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`
  return { date, time }
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
  const timestamp = formatTurnTime(turn.createdAt)
  const assistTimestamp = formatTurnTime(turn.assistantCreatedAt)

  return (
    <div className={`preview-turn${isLatest ? ' preview-turn-latest' : ''}`}>
      {/* User bubble */}
      <div className="preview-bubble preview-bubble-user">
        <span className="preview-bubble-label">
          you
          {timestamp && <span className="preview-bubble-time">{timestamp.date} {timestamp.time}</span>}
        </span>
        <p className="preview-bubble-text">{userDisplay}</p>
      </div>

      {/* Assistant bubble */}
      {assistDisplay ? (
        <div className="preview-bubble preview-bubble-assistant">
          <span className="preview-bubble-label">
            devin
            {assistTimestamp && <span className="preview-bubble-time">{assistTimestamp.time}</span>}
          </span>
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

export default function SessionPreview({ sessionId, onResume, onArchive, onRestore, onRename }) {
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const inputRef = useRef(null)

  // ── Full conversation viewer state ──────────────────────────────────────────
  const INITIAL_BATCH = 50
  const [convoTurns, setConvoTurns]     = useState([])      // accumulated turns (oldest first)
  const [convoTotal, setConvoTotal]     = useState(0)       // total turns available on server
  const [convoLoading, setConvoLoading] = useState(false)
  const [convoError, setConvoError]     = useState(null)
  const [nextBatch, setNextBatch]       = useState(INITIAL_BATCH)  // doubles each "load more"
  const threadColRef = useRef(null)
  const fetchingRef  = useRef(false)     // ref guard — survives React batching
  const convoTurnsLenRef = useRef(0)     // ref for offset to avoid stale closures

  // ── Subagent timeline state ─────────────────────────────────────────────────
  const [subagents, setSubagents] = useState(null)  // null = not loaded, [] = no subagents

  // ── Session config state ────────────────────────────────────────────────────
  const [sessionConfig, setSessionConfig] = useState(null)

  useEffect(() => {
    if (!sessionId) return
    setData(null)
    setError(null)
    setRenaming(false)
    // Reset conversation viewer state when switching sessions
    setConvoTurns([])
    setConvoTotal(0)
    setConvoError(null)
    setNextBatch(INITIAL_BATCH)
    fetchingRef.current = false
    setSubagents(null)
    setSessionConfig(null)
    fetch(`/api/sessions/${sessionId}/preview`)
      .then(r => r.json())
      .then(d => { setData(d); setNameValue(d.title) })
      .catch(e => setError(e.message))
  }, [sessionId])

  // Auto-load the initial conversation batch when preview data arrives
  useEffect(() => {
    if (!data || !sessionId || convoTurns.length > 0) return
    fetchingRef.current = false
    fetch(`/api/sessions/${sessionId}/conversation?offset=0&limit=${INITIAL_BATCH}`)
      .then(r => { if (!r.ok) throw new Error('Failed to load conversation'); return r.json() })
      .then(result => {
        setConvoTurns(result.turns)
        setConvoTotal(result.totalTurns)
        // Scroll to bottom to show most recent messages
        requestAnimationFrame(() => {
          const col = threadColRef.current
          if (col) col.scrollTop = col.scrollHeight
        })
      })
      .catch(e => setConvoError(e.message))
  }, [data, sessionId])

  // Lazy-fetch subagent timeline when preview reports subagentCount > 0
  useEffect(() => {
    if (!data || !sessionId || !data.subagentCount) return
    let cancelled = false
    fetch(`/api/sessions/${sessionId}/subagents`)
      .then(r => { if (!r.ok) throw new Error('subagent fetch failed'); return r.json() })
      .then(d => { if (!cancelled) setSubagents(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setSubagents([]) })  // silently degrade on error
    return () => { cancelled = true }
  }, [data, sessionId])

  // Lazy-fetch session config when preview data arrives
  useEffect(() => {
    if (!data || !sessionId) return
    let cancelled = false
    fetch(`/api/sessions/${sessionId}/config`)
      .then(r => { if (!r.ok) throw new Error('config fetch failed'); return r.json() })
      .then(d => { if (!cancelled) setSessionConfig(d) })
      .catch(() => { if (!cancelled) setSessionConfig(null) })
    return () => { cancelled = true }
  }, [data, sessionId])

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

  // ── Conversation loader ─────────────────────────────────────────────────────
  // Keep ref in sync so fetchConversation always has the latest offset
  useEffect(() => { convoTurnsLenRef.current = convoTurns.length }, [convoTurns.length])

  const fetchConversation = useCallback((limit, loadAll = false) => {
    if (!sessionId || fetchingRef.current) return
    fetchingRef.current = true
    setConvoLoading(true)
    setConvoError(null)

    const offset = convoTurnsLenRef.current
    const url = loadAll
      ? `/api/sessions/${sessionId}/conversation?offset=0&limit=0`
      : `/api/sessions/${sessionId}/conversation?offset=${offset}&limit=${limit}`

    fetch(url)
      .then(r => { if (!r.ok) throw new Error('Failed to load conversation'); return r.json() })
      .then(result => {
        // Preserve scroll position — measure before DOM update
        const col = threadColRef.current
        const prevScrollHeight = col?.scrollHeight || 0

        if (loadAll) {
          setConvoTurns(result.turns)
        } else {
          // Prepend older turns before existing ones
          setConvoTurns(prev => [...result.turns, ...prev])
        }
        setConvoTotal(result.totalTurns)
        if (!loadAll) setNextBatch(prev => prev * 2)

        // Restore scroll position after prepend
        requestAnimationFrame(() => {
          if (col && !loadAll) {
            const newScrollHeight = col.scrollHeight
            col.scrollTop += (newScrollHeight - prevScrollHeight)
          } else if (col && loadAll) {
            // Scroll to bottom when loading all
            col.scrollTop = col.scrollHeight
          }
        })
      })
      .catch(e => setConvoError(e.message))
      .finally(() => { fetchingRef.current = false; setConvoLoading(false) })
  }, [sessionId])

  const loadMore    = useCallback(() => fetchConversation(nextBatch), [fetchConversation, nextBatch])
  const loadAll     = useCallback(() => fetchConversation(0, true), [fetchConversation])

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
          {data.projectDurationStr && (
            <span className="preview-project-duration" title="Total wall-clock time across all sessions in this project">
              project total: {data.projectDurationStr}
            </span>
          )}
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
        {data.outputTokens > 0 && (
          <StatPill
            label="output tok"
            value={formatTokens(data.outputTokens)}
            highlight={data.outputTokens > 500000 ? 'var(--accent)' : undefined}
            tip="Total tokens generated by the LLM in this session. Higher output = more work done by the model."
          />
        )}
        {data.inputTokens > 0 && (
          <StatPill
            label="input tok"
            value={formatTokens(data.inputTokens)}
            tip="Total fresh input tokens sent to the LLM across all API calls in this session. These are non-cached context tokens."
          />
        )}
        {data.cacheReadTokens > 0 && (
          <StatPill
            label="cache read"
            value={formatTokens(data.cacheReadTokens)}
            tip="Tokens served from prompt cache hits. Cache reads are ~10× cheaper than fresh input tokens."
          />
        )}
        {data.cacheWriteTokens > 0 && (
          <StatPill
            label="cache write"
            value={formatTokens(data.cacheWriteTokens)}
            tip="Tokens written to the prompt cache. Cache creation costs ~1.25× the input token rate but pays for itself on subsequent cache hits."
          />
        )}
        {data.subagentCount > 0 && (
          <StatPill
            label="subagents"
            value={data.subagentCount}
            highlight="var(--purple)"
            tip="Number of subagents spawned by Devin during this session. Subagents handle delegated tasks (code exploration, parallel work) in their own context."
          />
        )}
      </div>

      {/* ── Two-column body ─────────────────────────────────────────── */}
      <div className="preview-body">

        {/* Left: chat thread */}
        <div className="preview-thread-col" ref={threadColRef}>

          {/* Sticky header: exchange count + load buttons */}
          <div className="preview-convo-header">
            <div className="preview-section-label" style={{ marginBottom: 0 }}>
              {convoTotal === 0 && convoTurns.length === 0
                ? 'Conversation'
                : convoTurns.length === convoTotal
                  ? `All ${convoTotal} exchanges`
                  : `${convoTurns.length} of ${convoTotal} exchanges`}
            </div>

            {convoTurns.length < convoTotal && convoTotal > 0 && (
              <div className="preview-convo-actions">
                <button
                  className="preview-convo-btn"
                  onClick={loadMore}
                  disabled={convoLoading}
                >
                  {convoLoading ? 'Loading…' : `Load ${Math.min(nextBatch, convoTotal - convoTurns.length)} more`}
                </button>
                <button
                  className="preview-convo-btn preview-convo-btn-all"
                  onClick={loadAll}
                  disabled={convoLoading}
                  title="Load everything for Ctrl+F search"
                >
                  Load all ({convoTotal})
                </button>
              </div>
            )}
          </div>

          {convoError && (
            <div className="preview-empty" style={{ color: 'var(--red)' }}>
              Error: {convoError}
            </div>
          )}

          {/* Conversation turns */}
          {convoTurns.length === 0 && !convoLoading ? (
            <div className="preview-empty">No conversation history found.</div>
          ) : convoTurns.length === 0 && convoLoading ? (
            <div className="preview-empty"><div className="spinner" style={{ display: 'inline-block', marginRight: 6 }} /> Loading conversation…</div>
          ) : (
            convoTurns.map((turn, i) => (
              <ChatBubble
                key={`${turn.createdAt}-${turn.userText.slice(0, 24)}`}
                turn={turn}
                index={i}
                total={convoTurns.length}
              />
            ))
          )}
        </div>

        {/* Right: tool breakdown + model section + session config + session info */}
        <div className="preview-tools-col">
          <div className="preview-section-label" style={{ marginTop: 14 }}>
            Tool breakdown
            <InfoBubble tip="How often Devin used each tool in this session. Tools let Devin interact with your system — run commands, read/edit files, search code, browse the web, and more." />
          </div>
          <ToolMiniBar tools={data.topTools} />

          <ModelSection
            startingModel={data.startingModel}
            currentModel={data.currentModel}
            modelSwitches={data.modelSwitches}
          />

          {subagents?.length > 0 && (
            <>
              <div className="preview-section-label" style={{ marginTop: 14 }}>
                Subagents
                <InfoBubble tip="Background and foreground subagents spawned by Devin during this session. Each subagent runs in its own context with a specific profile (explore = read-only, general = full access)." />
              </div>
              <SubagentTimeline subagents={subagents} />
            </>
          )}

          {sessionConfig && (sessionConfig.rules.length > 0 || sessionConfig.activeSkills.length > 0 || sessionConfig.permissions.length > 0) && (
            <>
              <div className="preview-section-label" style={{ marginTop: 14 }}>
                Session config
                <InfoBubble tip="Configuration active during this session — rules files injected into the system prompt, skills that were invoked, and permission grants from cogs." />
              </div>
              <div className="session-config-section">
                {sessionConfig.rules.length > 0 && (
                  <div className="session-config-group">
                    <div className="session-config-group-label">Rules</div>
                    <div className="session-config-chips">
                      {sessionConfig.rules.map(r => (
                        <span key={r} className="session-config-chip session-config-chip-rule" title={`AGENTS.md rule: ${r}`}>{r}</span>
                      ))}
                    </div>
                  </div>
                )}
                {sessionConfig.activeSkills.length > 0 && (
                  <div className="session-config-group">
                    <div className="session-config-group-label">Skills</div>
                    <div className="session-config-chips">
                      {sessionConfig.activeSkills.map(s => (
                        <span key={s.name} className="session-config-chip session-config-chip-skill" title={`Source: ${s.source}`}>{s.name}</span>
                      ))}
                    </div>
                  </div>
                )}
                {sessionConfig.permissions.length > 0 && (
                  <div className="session-config-group">
                    <div className="session-config-group-label">Permissions ({sessionConfig.permissions.length})</div>
                    <div className="session-config-chips">
                      {sessionConfig.permissions.slice(0, 8).map((p, i) => (
                        <span key={i} className="session-config-chip session-config-chip-perm" title={`${p.scope} → ${p.action}`}>
                          {p.action === 'Allow' ? '\u2713' : p.action === 'ForceAsk' ? '?' : p.action} {p.scope.length > 30 ? p.scope.slice(0, 29) + '\u2026' : p.scope}
                        </span>
                      ))}
                      {sessionConfig.permissions.length > 8 && (
                        <span className="session-config-chip session-config-chip-perm">+{sessionConfig.permissions.length - 8} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

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
        {data.archived ? (
          <button
            className="btn btn-restore"
            onClick={() => {
              onRestore(data.id)
              // Optimistically flip archived state so buttons update immediately
              setData(prev => prev ? { ...prev, archived: false, status: 'idle' } : prev)
            }}
            title="Restore to active sessions"
          >
            ↩ Restore
          </button>
        ) : (
          <button
            className="btn preview-btn-archive"
            onClick={() => onArchive(data.id)}
            title="Archive this session (reversible)"
          >
            ⊘ Archive
          </button>
        )}
        {!data.archived && (
          <button
            className="btn btn-primary preview-btn-resume"
            onClick={() => onResume(data.id)}
            title="Open live terminal for this session"
          >
            ▶ Resume session
          </button>
        )}
      </div>

    </div>
  )
}

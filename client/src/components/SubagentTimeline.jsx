/**
 * SubagentTimeline — vertical timeline of subagent lifecycle events.
 *
 * Shows each subagent spawned during a session: title, profile, duration,
 * and expandable task/result previews. Color-coded by profile:
 *   subagent_explore  → blue (research/read-only)
 *   subagent_general  → purple (full access, code changes)
 *
 * Designed to sit in the SessionPreview right column, below Model usage.
 */

import { useState } from 'react'

const PROFILE_COLORS = {
  subagent_explore: 'var(--blue)',
  subagent_general: 'var(--purple)',
}

const PROFILE_LABELS = {
  subagent_explore: 'explore',
  subagent_general: 'general',
}

function formatDuration(sec) {
  if (sec === null || sec === undefined) return null
  if (sec === 0) return '< 1s'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function SubagentEntry({ agent, isLast }) {
  const [expanded, setExpanded] = useState(false)
  const color = PROFILE_COLORS[agent.profile] || 'var(--purple)'
  const profileLabel = PROFILE_LABELS[agent.profile] || agent.profile
  const isComplete = agent.completedAt !== null
  const duration = formatDuration(agent.durationSec)

  return (
    <div className="sa-entry">
      {/* Timeline dot + line */}
      <div className="sa-track">
        <div className="sa-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        {!isLast && <div className="sa-line" />}
      </div>

      {/* Content */}
      <div className="sa-content">
        {/* Header row: title + badges */}
        <div className="sa-header">
          <span className="sa-title">{agent.title}</span>
          <div className="sa-badges">
            <span
              className="sa-profile-chip"
              style={{
                color,
                borderColor: color,
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
              }}
            >
              {profileLabel}
            </span>
            {!agent.isBackground && (
              <span className="sa-fg-chip">fg</span>
            )}
          </div>
        </div>

        {/* Status row: completion status + duration */}
        <div className="sa-meta">
          {isComplete ? (
            <span className="sa-status sa-status-done">completed</span>
          ) : (
            <span className="sa-status sa-status-unknown">no completion found</span>
          )}
          {duration && (
            <span className="sa-duration" style={{ color }}>{duration}</span>
          )}
          {agent.agentId && (
            <span className="sa-agent-id">{agent.agentId}</span>
          )}
        </div>

        {/* Expandable task + result */}
        {(agent.task || agent.resultPreview) && (
          <>
            <button className="sa-expand-btn" onClick={() => setExpanded(v => !v)}>
              {expanded ? '▲ collapse' : '▼ details'}
            </button>
            {expanded && (
              <div className="sa-details">
                {agent.task && (
                  <div className="sa-detail-block">
                    <span className="sa-detail-label">task</span>
                    <p className="sa-detail-text">{agent.task.slice(0, 600)}{agent.task.length > 600 ? '…' : ''}</p>
                  </div>
                )}
                {agent.resultPreview && (
                  <div className="sa-detail-block">
                    <span className="sa-detail-label">result</span>
                    <p className="sa-detail-text">{agent.resultPreview}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function SubagentTimeline({ subagents }) {
  if (!subagents?.length) return null

  const bgCount = subagents.filter(s => s.isBackground).length
  const fgCount = subagents.length - bgCount
  const completedCount = subagents.filter(s => s.completedAt !== null).length

  return (
    <div className="sa-timeline">
      <div className="sa-summary">
        {subagents.length} subagent{subagents.length !== 1 ? 's' : ''}
        <span className="sa-summary-detail">
          {bgCount > 0 && `${bgCount} bg`}
          {bgCount > 0 && fgCount > 0 && ' · '}
          {fgCount > 0 && `${fgCount} fg`}
          {' · '}
          {completedCount}/{subagents.length} completed
        </span>
      </div>
      {subagents.map((agent, i) => (
        <SubagentEntry
          key={agent.id}
          agent={agent}
          isLast={i === subagents.length - 1}
        />
      ))}
    </div>
  )
}

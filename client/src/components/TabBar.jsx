/**
 * TabBar — horizontal tab strip at the top of the main content area.
 *
 * Each tab represents one open session. Three click zones per tab:
 *   [Title area]  — activates the tab in terminal mode
 *   [info icon]   — toggles between terminal and preview/insights mode
 *   [X button]    — closes the tab entirely
 *
 * Active tab gets an accent underline (green for terminal, blue for preview).
 * Inactive tabs show a muted style. Close button appears on hover.
 */

import { memo } from 'react'
import { tabSessionId } from '../lib/tabState.js'

const STATUS_COLOR = {
  question: 'var(--yellow)',
  active:   'var(--blue)',
  finished: 'var(--accent)',
  idle:     'var(--text-muted)',
}

export default memo(function TabBar({ tabs, activeTabId, sessions, onActivate, onTogglePreview, onClose }) {
  if (tabs.length === 0) {
    return <div className="tab-bar tab-bar-empty" />
  }

  return (
    <div className="tab-bar">
      {tabs.map(tab => {
        const session = sessions.find(s => s.id === tabSessionId(tab))
        const isActive = tab.id === activeTabId
        const title = session?.title || tab.id.slice(0, 8)
        const status = session?.status || 'idle'
        const isPreview = tab.mode === 'preview'

        const tabClasses = [
          'tab-item',
          isActive   ? 'tab-active'  : '',
          isPreview  ? 'tab-preview' : '',
        ].filter(Boolean).join(' ')

        return (
          <div
            key={tab.id}
            className={tabClasses}
            onClick={() => onActivate(tab.id)}
            title={title}
          >
            <span
              className="tab-status-dot"
              style={{ background: STATUS_COLOR[status] || 'var(--text-muted)' }}
            />
            <span className="tab-title">{title}</span>
            <button
              className={`tab-insights-btn${isPreview && isActive ? ' tab-insights-active' : ''}`}
              onClick={e => { e.stopPropagation(); onTogglePreview(tab.id) }}
              title="Session insights"
            >
              ⓘ
            </button>
            <button
              className="tab-close-btn"
              onClick={e => { e.stopPropagation(); onClose(tab.id) }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
})

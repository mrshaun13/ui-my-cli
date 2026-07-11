export function tabSessionId(tab) {
  return tab?.canonicalId || tab?.id || null
}

export function tabTransportId(tab) {
  return tab?.transportId || tab?.id || null
}

export function stableTabState(tabs, activeTabId) {
  const stableTabs = new Map()
  let stableActiveTabId = null
  for (const tab of tabs) {
    const stableId = tab?.collision ? tabSessionId(tab) : tab?.id
    if (!stableId) continue
    const stableTab = {
      id: stableId,
      mode: tab.mode || 'terminal',
      mountKey: stableId,
      canonicalId: stableId,
      transportId: stableId,
    }
    if (!stableTabs.has(stableId) || tab.id === activeTabId) {
      stableTabs.set(stableId, stableTab)
    }
    if (tab.id === activeTabId) stableActiveTabId = stableId
  }
  const normalizedTabs = [...stableTabs.values()]
  if (!stableTabs.has(stableActiveTabId)) {
    stableActiveTabId = normalizedTabs[0]?.id || null
  }
  return { tabs: normalizedTabs, activeTabId: stableActiveTabId }
}

export function tabReducer(state, action) {
  switch (action.type) {
    case 'open': {
      const { id, mode } = action
      const exists = state.tabs.find(tab => tab.id === id)
      if (exists) {
        return {
          tabs: state.tabs.map(tab => tab.id === id ? { ...tab, mode } : tab),
          activeTabId: id,
        }
      }
      return {
        tabs: [...state.tabs, {
          id,
          mode,
          mountKey: id,
          canonicalId: id,
          transportId: id,
        }],
        activeTabId: id,
      }
    }
    case 'activate': {
      const tab = state.tabs.find(candidate => candidate.id === action.id)
      if (!tab) return state
      return {
        tabs: state.tabs.map(candidate => candidate.id === action.id
          ? { ...candidate, mode: 'terminal' }
          : candidate),
        activeTabId: action.id,
      }
    }
    case 'togglePreview': {
      const tab = state.tabs.find(candidate => candidate.id === action.id)
      if (!tab) return state
      return {
        tabs: state.tabs.map(candidate => candidate.id === action.id
          ? { ...candidate, mode: candidate.mode === 'preview' ? 'terminal' : 'preview' }
          : candidate),
        activeTabId: action.id,
      }
    }
    case 'close': {
      const index = state.tabs.findIndex(tab => tab.id === action.id)
      if (index === -1) return state
      const tabs = state.tabs.filter(tab => tab.id !== action.id)
      let activeTabId = state.activeTabId
      if (state.activeTabId === action.id) {
        activeTabId = tabs.length === 0 ? null : tabs[Math.min(index, tabs.length - 1)].id
      }
      return { tabs, activeTabId }
    }
    case 'rekey': {
      const { oldId, newId } = action
      if (!state.tabs.some(tab => tab.id === oldId)) return state
      const collision = action.collision || state.tabs.some(tab => tab.id === newId)
      if (collision) {
        return {
          tabs: state.tabs.map(tab => tab.id === oldId
            ? { ...tab, canonicalId: newId, collision: true }
            : tab),
          activeTabId: state.activeTabId,
        }
      }
      return {
        tabs: state.tabs.map(tab => tab.id === oldId
          ? {
              ...tab,
              id: newId,
              canonicalId: newId,
              transportId: newId,
            }
          : tab),
        activeTabId: state.activeTabId === oldId ? newId : state.activeTabId,
      }
    }
    case 'deactivate':
      return { ...state, activeTabId: null }
    case 'restore':
      return { tabs: action.tabs, activeTabId: action.activeTabId }
    case 'reset':
      return { tabs: [], activeTabId: null }
    default:
      return state
  }
}

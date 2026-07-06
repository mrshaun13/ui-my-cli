export const DEFAULT_DASHBOARD_STYLE_ID = 'signal'

export const DASHBOARD_STYLES = [
  { id: 'signal', label: 'Signal', mode: 'dark', swatch: '#00ffa3', isDefault: true },
  { id: 'carbon', label: 'Carbon', mode: 'dark', swatch: '#38bdf8' },
  { id: 'midnight', label: 'Midnight', mode: 'dark', swatch: '#7dd3fc' },
  { id: 'forest', label: 'Forest', mode: 'dark', swatch: '#a3e635' },
  { id: 'solarized-dark', label: 'Solarized Dark', mode: 'dark', swatch: '#2aa198' },
  { id: 'plum', label: 'Plum', mode: 'dark', swatch: '#f0abfc' },
  { id: 'ember', label: 'Ember', mode: 'dark', swatch: '#fb923c' },
  { id: 'paper', label: 'Paper', mode: 'light', swatch: '#2563eb' },
  { id: 'arctic', label: 'Arctic', mode: 'light', swatch: '#0891b2' },
  { id: 'solarized-light', label: 'Solarized Light', mode: 'light', swatch: '#268bd2' },
]

const STORAGE_STYLE = 'agent-dash:style'
const STYLE_IDS = new Set(DASHBOARD_STYLES.map(style => style.id))

export function loadDashboardStyle() {
  try {
    const saved = localStorage.getItem(STORAGE_STYLE)
    return STYLE_IDS.has(saved) ? saved : DEFAULT_DASHBOARD_STYLE_ID
  } catch {
    return DEFAULT_DASHBOARD_STYLE_ID
  }
}

export function applyDashboardStyle(styleId) {
  const nextStyle = STYLE_IDS.has(styleId) ? styleId : DEFAULT_DASHBOARD_STYLE_ID
  document.documentElement.dataset.dashboardStyle = nextStyle
  document.documentElement.style.colorScheme = DASHBOARD_STYLES.find(style => style.id === nextStyle)?.mode || 'dark'
}

export function saveDashboardStyle(styleId) {
  try { localStorage.setItem(STORAGE_STYLE, styleId) } catch { /* ignore unavailable storage */ }
}

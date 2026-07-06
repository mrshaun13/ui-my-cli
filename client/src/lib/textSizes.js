export const DEFAULT_TEXT_SIZE_ID = 'standard'

export const TEXT_SIZES = [
  { id: 'standard', label: 'Standard', shortLabel: 'S', scale: 1, terminalFontSize: 13 },
  { id: 'large', label: 'Large', shortLabel: 'L', scale: 1.15, terminalFontSize: 15 },
  { id: 'xl', label: 'XL', shortLabel: 'XL', scale: 1.31, terminalFontSize: 17 },
  { id: 'xxl', label: 'XXL', shortLabel: 'XXL', scale: 1.46, terminalFontSize: 19 },
]

const STORAGE_TEXT_SIZE = 'agent-dash:text-size'
const TEXT_SIZE_IDS = new Set(TEXT_SIZES.map(size => size.id))

export function loadTextSize() {
  try {
    const saved = localStorage.getItem(STORAGE_TEXT_SIZE)
    return TEXT_SIZE_IDS.has(saved) ? saved : DEFAULT_TEXT_SIZE_ID
  } catch {
    return DEFAULT_TEXT_SIZE_ID
  }
}

export function applyTextSize(textSizeId) {
  document.documentElement.dataset.textSize = TEXT_SIZE_IDS.has(textSizeId)
    ? textSizeId
    : DEFAULT_TEXT_SIZE_ID
}

export function saveTextSize(textSizeId) {
  try { localStorage.setItem(STORAGE_TEXT_SIZE, textSizeId) } catch { /* ignore unavailable storage */ }
}

export function terminalFontSizeFor(textSizeId) {
  return TEXT_SIZES.find(size => size.id === textSizeId)?.terminalFontSize
    || TEXT_SIZES[0].terminalFontSize
}

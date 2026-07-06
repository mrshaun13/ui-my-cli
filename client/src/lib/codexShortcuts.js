const SHIFT_ARROW_SEQUENCES = {
  ArrowUp: '\x1b[1;2A',
  ArrowDown: '\x1b[1;2B',
  ArrowRight: '\x1b[1;2C',
  ArrowLeft: '\x1b[1;2D',
}

const CTRL_ARROW_SEQUENCES = {
  ArrowUp: '\x1b[1;5A',
  ArrowDown: '\x1b[1;5B',
  ArrowRight: '\x1b[1;5C',
  ArrowLeft: '\x1b[1;5D',
}

const CTRL_KEY_SEQUENCES = {
  a: '\x01',
  b: '\x02',
  d: '\x04',
  e: '\x05',
  f: '\x06',
  h: '\x08',
  j: '\n',
  k: '\x0b',
  l: '\x0c',
  n: '\x0e',
  o: '\x0f',
  p: '\x10',
  u: '\x15',
  w: '\x17',
}

const ALT_KEY_SEQUENCES = {
  b: '\x1bb',
  d: '\x1bd',
  f: '\x1bf',
  Backspace: '\x1b\x7f',
}

export const CODEX_SHORTCUT_HINTS = [
  { keys: 'Shift+Enter', label: 'newline' },
  { keys: 'Shift+Up/Down', label: 'reasoning' },
  { keys: 'Ctrl+O', label: 'copy reply' },
  { keys: 'Ctrl+A/E', label: 'line start/end' },
  { keys: '/permissions', label: 'access' },
]

const LEGACY_SHORTCUT_HINTS = [
  { keys: 'Alt+T', label: 'thinking' },
  { keys: '!', label: 'shell' },
  { keys: 'Ctrl+C', label: 'clear line' },
  { keys: 'Ctrl+Enter', label: 'newline' },
]

export function shortcutHintsForProvider(providerId) {
  return providerId === 'codex' ? CODEX_SHORTCUT_HINTS : LEGACY_SHORTCUT_HINTS
}

export function isTerminalPasteKeyEvent(e) {
  if (e.type !== 'keydown' || e.altKey) return false

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if ((e.ctrlKey || e.metaKey) && key === 'v') return true

  return e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === 'Insert'
}

/**
 * Browser terminals do not reliably forward some modified keys that Codex
 * handles in a native terminal. Convert those KeyboardEvents into the same
 * byte sequences a PTY-backed shell would receive locally.
 */
export function codexInputForKeyEvent(e) {
  if (e.type !== 'keydown') return null

  if (!e.altKey && !e.metaKey && e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
    return '\n'
  }

  if (!e.ctrlKey && !e.altKey && !e.metaKey && e.shiftKey && SHIFT_ARROW_SEQUENCES[e.key]) {
    return SHIFT_ARROW_SEQUENCES[e.key]
  }

  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && CTRL_ARROW_SEQUENCES[e.key]) {
    return CTRL_ARROW_SEQUENCES[e.key]
  }

  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    return CTRL_KEY_SEQUENCES[key] ?? null
  }

  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    return ALT_KEY_SEQUENCES[key] ?? null
  }

  return null
}

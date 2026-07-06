import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  codexInputForKeyEvent,
  CODEX_SHORTCUT_HINTS,
  isTerminalPasteKeyEvent,
  shortcutHintsForProvider,
} from '../client/src/lib/codexShortcuts.js'

const keydown = (overrides) => ({
  type: 'keydown',
  key: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
})

test('normalizes Codex newline shortcuts', () => {
  assert.equal(codexInputForKeyEvent(keydown({ key: 'Enter', shiftKey: true })), '\n')
  assert.equal(codexInputForKeyEvent(keydown({ key: 'Enter', ctrlKey: true })), '\n')
})

test('normalizes Codex reasoning shortcut arrows', () => {
  assert.equal(codexInputForKeyEvent(keydown({ key: 'ArrowUp', shiftKey: true })), '\x1b[1;2A')
  assert.equal(codexInputForKeyEvent(keydown({ key: 'ArrowDown', shiftKey: true })), '\x1b[1;2B')
})

test('normalizes browser-reserved Codex control shortcuts', () => {
  assert.equal(codexInputForKeyEvent(keydown({ key: 'o', ctrlKey: true })), '\x0f')
  assert.equal(codexInputForKeyEvent(keydown({ key: 'a', ctrlKey: true })), '\x01')
  assert.equal(codexInputForKeyEvent(keydown({ key: 'e', ctrlKey: true })), '\x05')
  assert.equal(codexInputForKeyEvent(keydown({ key: 'f', ctrlKey: true })), '\x06')
  assert.equal(codexInputForKeyEvent(keydown({ key: 'w', ctrlKey: true })), '\x17')
})

test('identifies browser paste gestures that must not reach Codex as raw control bytes', () => {
  assert.equal(isTerminalPasteKeyEvent(keydown({ key: 'v', ctrlKey: true })), true)
  assert.equal(isTerminalPasteKeyEvent(keydown({ key: 'V', ctrlKey: true, shiftKey: true })), true)
  assert.equal(isTerminalPasteKeyEvent(keydown({ key: 'v', metaKey: true })), true)
  assert.equal(isTerminalPasteKeyEvent(keydown({ key: 'Insert', shiftKey: true })), true)
  assert.equal(isTerminalPasteKeyEvent(keydown({ key: 'v' })), false)
  assert.equal(isTerminalPasteKeyEvent(keydown({ key: 'v', ctrlKey: true, altKey: true })), false)
})

test('keeps visible helper hints aligned with required Codex commands', () => {
  const hints = CODEX_SHORTCUT_HINTS.map(({ keys, label }) => `${keys} ${label}`)
  assert.deepEqual(hints, [
    'Shift+Enter newline',
    'Shift+Up/Down reasoning',
    'Ctrl+O copy reply',
    'Ctrl+A/E line start/end',
    '/permissions access',
  ])
})

test('scopes the updated helper hints to Codex sessions', () => {
  assert.equal(shortcutHintsForProvider('codex'), CODEX_SHORTCUT_HINTS)
  assert.deepEqual(
    shortcutHintsForProvider('devin').map(({ keys, label }) => `${keys} ${label}`),
    [
      'Alt+T thinking',
      '! shell',
      'Ctrl+C clear line',
      'Ctrl+Enter newline',
    ],
  )
})

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const provider = require('../server/providers/codex/index.js')

test('Codex provider prefers the user install over an older PATH binary', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'ui-my-cli-codex-bin-'))
  const binDir = path.join(home, '.local', 'bin')
  const executable = path.join(binDir, 'codex')
  const previousHome = process.env.HOME
  const previousBin = process.env.CODEX_BIN
  mkdirSync(binDir, { recursive: true })
  writeFileSync(executable, '')

  try {
    process.env.HOME = home
    delete process.env.CODEX_BIN
    assert.deepEqual(provider.buildCommand('session-id'), {
      command: executable,
      args: ['-c', 'tui.animations=false', 'resume', 'session-id'],
    })
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousBin === undefined) delete process.env.CODEX_BIN
    else process.env.CODEX_BIN = previousBin
    rmSync(home, { recursive: true, force: true })
  }
})

test('CODEX_BIN explicitly selects the Codex executable', () => {
  const previous = process.env.CODEX_BIN
  try {
    process.env.CODEX_BIN = '/opt/codex/current/bin/codex'
    assert.deepEqual(provider.buildCommand(null), {
      command: '/opt/codex/current/bin/codex',
      args: ['-c', 'tui.animations=false'],
    })
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN
    else process.env.CODEX_BIN = previous
  }
})

test('Codex provider can launch the authentic TUI through an Adaptive app-server endpoint', () => {
  const previous = process.env.CODEX_BIN
  try {
    process.env.CODEX_BIN = '/opt/codex/current/bin/codex'
    assert.deepEqual(provider.buildCommand('session-id', { remoteEndpoint: 'ws://127.0.0.1:45678' }), {
      command: '/opt/codex/current/bin/codex',
      args: [
        '-c', 'tui.animations=false',
        '--remote', 'ws://127.0.0.1:45678',
        'resume', 'session-id',
      ],
    })
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN
    else process.env.CODEX_BIN = previous
  }
})

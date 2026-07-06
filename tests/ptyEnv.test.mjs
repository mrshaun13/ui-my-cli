import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { interactivePtyEnv } = require('../server/pty-manager.js')

test('interactive PTYs override inherited no-color and CI flags', () => {
  const previous = {
    noColor: process.env.NO_COLOR,
    codexCi: process.env.CODEX_CI,
  }
  process.env.NO_COLOR = '1'
  process.env.CODEX_CI = '1'

  try {
    const env = interactivePtyEnv('codex')
    assert.equal(env.NO_COLOR, undefined)
    assert.equal(env.CODEX_CI, undefined)
    assert.equal(env.TERM, 'xterm-256color')
    assert.equal(env.COLORTERM, 'truecolor')
    assert.equal(env.UI_MY_CLI_DASHBOARD, '1')
    assert.equal(env.UI_MY_CLI_PROVIDER, 'codex')
  } finally {
    if (previous.noColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = previous.noColor
    if (previous.codexCi === undefined) delete process.env.CODEX_CI
    else process.env.CODEX_CI = previous.codexCi
  }
})

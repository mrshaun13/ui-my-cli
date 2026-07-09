import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { interactivePtyEnv, ensurePtySpawnHelperIsExecutable } = require('../server/pty-manager.js')

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

test('macOS PTY helper is repaired when npm loses its executable mode', () => {
  const chmods = []
  const changed = ensurePtySpawnHelperIsExecutable({
    platform: 'darwin',
    arch: 'arm64',
    nodePtyDirectory: '/checkout/node_modules/node-pty',
    existsSync: candidate => candidate.endsWith('/darwin-arm64/spawn-helper'),
    statSync: () => ({ mode: 0o100644 }),
    chmodSync: (candidate, mode) => chmods.push({ candidate, mode }),
  })

  assert.equal(changed, true)
  assert.deepEqual(chmods, [{
    candidate: '/checkout/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
    mode: 0o100755,
  }])
})

test('PTY helper leaves an executable helper untouched', () => {
  let chmodCalled = false
  const changed = ensurePtySpawnHelperIsExecutable({
    platform: 'darwin',
    arch: 'arm64',
    nodePtyDirectory: '/checkout/node_modules/node-pty',
    existsSync: () => true,
    statSync: () => ({ mode: 0o100755 }),
    chmodSync: () => { chmodCalled = true },
  })

  assert.equal(changed, false)
  assert.equal(chmodCalled, false)
})

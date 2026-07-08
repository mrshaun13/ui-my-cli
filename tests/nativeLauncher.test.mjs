import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  ACTIVATE_OR_LAUNCH_SCRIPT,
  WSL_POWERSHELL,
  launchWindowsNativeDashboard,
  resolvePowerShell,
} = require('../server/native-launcher.js')

test('native launcher resolves PowerShell on Windows and WSL2 only', () => {
  assert.equal(resolvePowerShell('win32', () => false), 'powershell.exe')
  assert.equal(resolvePowerShell('linux', candidate => candidate === WSL_POWERSHELL), WSL_POWERSHELL)
  assert.equal(resolvePowerShell('linux', () => false), null)
  assert.equal(resolvePowerShell('darwin', () => true), null)
})

test('native launcher runs a fixed activation-or-launch script without user input', async () => {
  let invocation
  const action = await launchWindowsNativeDashboard({
    platform: 'linux',
    existsSync: candidate => candidate === WSL_POWERSHELL,
    execFileImpl: (file, args, options, callback) => {
      invocation = { file, args, options }
      callback(null, 'activated\n', '')
    },
  })

  assert.equal(action, 'activated')
  assert.equal(invocation.file, WSL_POWERSHELL)
  assert.equal(invocation.args.at(-1), ACTIVATE_OR_LAUNCH_SCRIPT)
  assert.equal(invocation.options.timeout, 5000)
  assert.match(ACTIVATE_OR_LAUNCH_SCRIPT, /LOCALAPPDATA/)
  assert.match(ACTIVATE_OR_LAUNCH_SCRIPT, /AppActivate/)
})

test('native launcher reports unsupported hosts without spawning a process', async () => {
  await assert.rejects(
    launchWindowsNativeDashboard({ platform: 'linux', existsSync: () => false }),
    error => error.code === 'NATIVE_LAUNCH_UNAVAILABLE',
  )
})

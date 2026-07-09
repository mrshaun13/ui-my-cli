import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  ACTIVATE_OR_LAUNCH_SCRIPT,
  MACOS_OPEN,
  WSL_POWERSHELL,
  isTrustedLaunchRequest,
  launchNativeDashboard,
  nativeLaunchCapability,
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
  const action = await launchNativeDashboard({
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
  assert.match(ACTIVATE_OR_LAUNCH_SCRIPT, /Programs\\CodexNative\\CodexNative\.exe/)
  assert.match(ACTIVATE_OR_LAUNCH_SCRIPT, /AppActivate/)
})

test('native launcher activates the macOS application through LaunchServices', async () => {
  let invocation
  const action = await launchNativeDashboard({
    platform: 'darwin',
    existsSync: candidate => candidate === MACOS_OPEN,
    execFileImpl: (file, args, options, callback) => {
      invocation = { file, args, options }
      callback(null, '', '')
    },
  })

  assert.equal(action, 'started')
  assert.equal(invocation.file, MACOS_OPEN)
  assert.deepEqual(invocation.args, ['-a', 'CodexNative'])
  assert.equal(invocation.options.timeout, 5000)
  assert.deepEqual(nativeLaunchCapability('darwin', candidate => candidate === MACOS_OPEN), {
    supported: true,
    platform: 'macos',
    label: 'Launch native app',
  })
})

test('native launcher reports unsupported hosts without spawning a process', async () => {
  await assert.rejects(
    launchNativeDashboard({ platform: 'linux', existsSync: () => false }),
    error => error.code === 'NATIVE_LAUNCH_UNAVAILABLE',
  )
  assert.equal(nativeLaunchCapability('linux', () => false).supported, false)
})

test('native launcher rejects cross-site browser requests', () => {
  assert.equal(isTrustedLaunchRequest({ host: '127.0.0.1:7575' }), true)
  assert.equal(isTrustedLaunchRequest({
    origin: 'http://127.0.0.1:7575',
    host: '127.0.0.1:7575',
    fetchSite: 'same-origin',
  }), true)
  assert.equal(isTrustedLaunchRequest({
    origin: 'https://example.com',
    host: '127.0.0.1:7575',
    fetchSite: 'cross-site',
  }), false)
  assert.equal(isTrustedLaunchRequest({
    origin: 'http://localhost:9999',
    host: '127.0.0.1:7575',
  }), false)
})

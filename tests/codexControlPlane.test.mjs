import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  wantsCodexControlPlane,
  tryStartCodexControlPlane,
} = require('../server/codex-control-plane.js')

test('Codex control-plane requests are independent from Adaptive routing state', () => {
  assert.equal(wantsCodexControlPlane('codex', { controlPlane: true }), true)
  assert.equal(wantsCodexControlPlane('codex', { controlPlane: '1' }), true)
  assert.equal(wantsCodexControlPlane('codex', { controlPlane: false }), false)
  assert.equal(wantsCodexControlPlane('devin', { controlPlane: true }), false)
})

test('legacy Adaptive transport requests remain compatible', () => {
  assert.equal(wantsCodexControlPlane('codex', { adaptive: true }), true)
  assert.equal(wantsCodexControlPlane('codex', { adaptive: '1' }), true)
})

test('control-plane startup failure falls back without rejecting terminal launch', async () => {
  const failure = new Error('app-server unavailable')
  let reported = null
  const endpoint = await tryStartCodexControlPlane(
    async () => { throw failure },
    error => { reported = error })

  assert.equal(endpoint, null)
  assert.equal(reported, failure)
})

test('control-plane startup returns the remote endpoint when available', async () => {
  const endpoint = await tryStartCodexControlPlane(
    async () => 'ws://127.0.0.1:45678')
  assert.equal(endpoint, 'ws://127.0.0.1:45678')
})

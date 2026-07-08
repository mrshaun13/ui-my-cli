import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { CodexAppServer } = require('../server/codex-app-server.js')

test('the first Adaptive prompt starts its thread and turn before the TUI resumes it', async () => {
  const appServer = new CodexAppServer({ executable: () => 'codex' })
  const requests = []
  appServer.resolveAdaptiveRoute = async () => ({
    model: 'frontier',
    effort: 'high',
    level: 'deep',
    source: 'local',
    classifierUsed: false,
  })
  appServer.request = async (method, params) => {
    requests.push({ method, params })
    if (method === 'thread/start') return { thread: { id: 'thread-123' } }
    return { turn: { id: 'turn-456' } }
  }

  const result = await appServer.startAdaptiveTurn(
    '/workspace/project',
    'Implement the feature',
    'quality',
  )

  assert.equal(result.threadId, 'thread-123')
  assert.equal(result.turnId, 'turn-456')
  assert.deepEqual(requests, [
    {
      method: 'thread/start',
      params: { cwd: '/workspace/project', model: 'frontier' },
    },
    {
      method: 'turn/start',
      params: {
        threadId: 'thread-123',
        input: [{ type: 'text', text: 'Implement the feature' }],
        model: 'frontier',
        effort: 'high',
      },
    },
  ])
})

test('the first Adaptive prompt rejects missing working directories and thread IDs', async () => {
  const appServer = new CodexAppServer({ executable: () => 'codex' })
  await assert.rejects(
    () => appServer.startAdaptiveTurn('', 'Prompt'),
    /working directory is required/,
  )

  appServer.resolveAdaptiveRoute = async () => ({ model: 'frontier', effort: 'medium' })
  appServer.request = async () => ({ thread: {} })
  await assert.rejects(
    () => appServer.startAdaptiveTurn('/workspace/project', 'Prompt'),
    /did not create an Adaptive thread/,
  )
})

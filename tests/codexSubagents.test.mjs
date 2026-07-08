import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { parseSubagentsFromLines } = require('../server/subagents.js')

test('Codex subagent activity becomes a structured lifecycle timeline', () => {
  const childId = '019f-child-agent'
  const events = [
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'spawn_agent',
        call_id: 'call-spawn-1',
        arguments: JSON.stringify({ task_name: 'audit_context_paths', message: 'encrypted' }),
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'sub_agent_activity',
        event_id: 'call-spawn-1',
        agent_thread_id: childId,
        agent_path: 'parent/audit_context_paths',
        kind: 'started',
        occurred_at_ms: 1_750_000_000_000,
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'sub_agent_activity',
        event_id: 'call-interaction-1',
        agent_thread_id: childId,
        kind: 'interacted',
        occurred_at_ms: 1_750_000_065_000,
      },
    },
  ]
  const children = new Map([[childId, {
    agent_nickname: 'Quill',
    agent_role: 'explorer',
    updated_at: 1_750_000_065,
    resultPreview: 'Context telemetry is complete.',
  }]])

  const timeline = parseSubagentsFromLines(events, children)

  assert.equal(timeline.length, 1)
  assert.deepEqual(timeline[0], {
    id: 'call-spawn-1',
    agentId: childId,
    title: 'audit context paths',
    profile: 'explorer',
    nickname: 'Quill',
    task: 'Delegated task: audit context paths',
    resultPreview: 'Context telemetry is complete.',
    startedAt: 1_750_000_000,
    completedAt: 1_750_000_065,
    durationSec: 65,
    isBackground: true,
    status: 'completed',
    path: 'parent/audit_context_paths',
    order: 0,
  })
})

test('a started Codex subagent without a result remains running', () => {
  const timeline = parseSubagentsFromLines([
    {
      type: 'event_msg',
      timestamp: '2026-07-07T10:00:00Z',
      payload: {
        type: 'sub_agent_activity',
        event_id: 'call-2',
        agent_thread_id: 'child-2',
        agent_path: 'parent/reviewer',
        kind: 'started',
      },
    },
  ])

  assert.equal(timeline[0].title, 'reviewer')
  assert.equal(timeline[0].status, 'running')
  assert.equal(timeline[0].completedAt, null)
  assert.equal(timeline[0].durationSec, null)
})

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const threadId = '019f48c8-3092-71e0-adf2-700a6b7081ac'

function turnContext(model, effort) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'turn_context',
    payload: {
      turn_id: `turn-${model}`,
      model,
      effort,
      collaboration_mode: { settings: { reasoning_effort: effort } },
    },
  })
}

test('session and context APIs follow the latest persisted turn model', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ui-my-cli-model-refresh-'))
  const statePath = path.join(dir, 'state_5.sqlite')
  const sessionsDir = path.join(dir, 'sessions')
  const rolloutPath = path.join(sessionsDir, `rollout-${threadId}.jsonl`)
  mkdirSync(sessionsDir, { recursive: true })
  writeFileSync(rolloutPath, [
    turnContext('gpt-initial', 'medium'),
    turnContext('gpt-adaptive', 'high'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          model_context_window: 300000,
          total_token_usage: { total_tokens: 1200 },
          last_token_usage: { total_tokens: 1200 },
        },
      },
    }),
  ].join('\n') + '\n')

  const db = new Database(statePath)
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL
    )
  `)
  db.prepare(`
    INSERT INTO threads
      (id, rollout_path, created_at, updated_at, source, cwd, title, model, reasoning_effort)
    VALUES (?, ?, 1, 2, 'cli', ?, 'Model refresh test', 'gpt-stale-db', 'low')
  `).run(threadId, rolloutPath, dir)
  db.close()

  process.env.CODEX_HOME = dir
  process.env.CODEX_STATE_DB_PATH = statePath
  process.env.UI_MY_CLI_DB_PATH = path.join(dir, 'dashboard.sqlite')

  try {
    const store = require('../server/codex-store.js')
    let session = store.listSessions().find(candidate => candidate.id === threadId)
    assert.equal(session.model, 'gpt-adaptive')
    assert.equal(session.reasoningEffort, 'high')
    assert.equal(store.getSessionConfig(threadId).model, 'gpt-adaptive')
    assert.equal(store.getSessionConfig(threadId).reasoningEffort, 'high')
    assert.equal(store.getSessionContextBreakdown(threadId).model, 'gpt-adaptive')
    assert.equal(store.getSessionContextBreakdown(threadId).maxContext, 300000)

    appendFileSync(rolloutPath, turnContext('gpt-manual', 'minimal') + '\n')
    session = store.listSessions().find(candidate => candidate.id === threadId)
    assert.equal(session.model, 'gpt-manual')
    assert.equal(session.reasoningEffort, 'minimal')
    assert.equal(store.getSessionConfig(threadId).model, 'gpt-manual')
    assert.equal(store.getSessionConfig(threadId).reasoningEffort, 'minimal')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CODEX_HOME
    delete process.env.CODEX_STATE_DB_PATH
    delete process.env.UI_MY_CLI_DB_PATH
  }
})

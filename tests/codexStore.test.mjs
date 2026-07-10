import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { test } from 'node:test'

const threadId = '019f1a8b-2bc5-7403-8f89-afc616b835cc'

function createStateDb(file) {
  const db = new Database(file)
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL DEFAULT 'openai',
      cwd TEXT NOT NULL DEFAULT '/',
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL DEFAULT '',
      approval_mode TEXT NOT NULL DEFAULT '',
      first_user_message TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT ''
    )
  `)
  db.prepare(`
    INSERT INTO threads (id, source, title, first_user_message)
    VALUES (?, 'vscode', 'Old title', 'Original prompt')
  `).run(threadId)
  db.close()
}

test('native Codex rename validation resolves a title without writing Codex state', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ui-my-cli-rename-'))
  const statePath = path.join(dir, 'state_5.sqlite')
  createStateDb(statePath)
  process.env.CODEX_HOME = dir
  process.env.CODEX_STATE_DB_PATH = statePath
  process.env.UI_MY_CLI_DB_PATH = path.join(dir, 'dashboard.sqlite')

  try {
    const { resolveNativeRenameTitle } = await import('../server/codex-store.js')
    assert.deepEqual(resolveNativeRenameTitle(threadId, 'Fix keyboard shortcuts and rename functionality'), {
      id: threadId,
      title: 'Fix keyboard shortcuts and rename functionality',
    })

    const db = new Database(statePath, { readonly: true })
    assert.equal(db.prepare('SELECT title FROM threads WHERE id = ?').get(threadId).title, 'Old title')
    db.close()
    assert.throws(() => resolveNativeRenameTitle(threadId, 'bad\nname'), /control characters/)
    assert.throws(() => resolveNativeRenameTitle(threadId, 'x'.repeat(201)), /1-200 characters/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CODEX_HOME
    delete process.env.CODEX_STATE_DB_PATH
    delete process.env.UI_MY_CLI_DB_PATH
  }
})

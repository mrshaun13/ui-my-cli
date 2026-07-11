import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    const { findNewSessionInDir, getSession, latestPrompt, resolveNativeRenameTitle } = await import('../server/codex-store.js')
    assert.deepEqual(resolveNativeRenameTitle(threadId, 'Fix keyboard shortcuts and rename functionality'), {
      id: threadId,
      title: 'Fix keyboard shortcuts and rename functionality',
    })

    const db = new Database(statePath, { readonly: true })
    assert.equal(db.prepare('SELECT title FROM threads WHERE id = ?').get(threadId).title, 'Old title')
    db.close()
    assert.throws(() => resolveNativeRenameTitle(threadId, 'bad\nname'), /control characters/)
    assert.throws(() => resolveNativeRenameTitle(threadId, 'bad\u0085name'), /control characters/)
    assert.throws(() => resolveNativeRenameTitle(threadId, 'x'.repeat(161)), /1-160 characters/)
    assert.deepEqual(resolveNativeRenameTitle(threadId, '🙂'.repeat(160)), {
      id: threadId,
      title: '🙂'.repeat(160),
    })

    const writablePrompt = new Database(statePath)
    writablePrompt.prepare(`
      UPDATE threads
      SET title = '', first_user_message = ?, preview = ?, updated_at = ?
      WHERE id = ?
    `).run('<environment_context>injected dashboard metadata</environment_context>', 'safe fallback', 4_102_444_800, threadId)
    writablePrompt.close()
    assert.equal(getSession(threadId).firstUserPrompt, null)
    assert.equal(resolveNativeRenameTitle(threadId, null).title, 'safe fallback')
    assert.equal(latestPrompt().prompt, 'safe fallback')

    const writableMetadata = new Database(statePath)
    writableMetadata.prepare(`
      UPDATE threads
      SET title = ?, first_user_message = ?, preview = ?
      WHERE id = ?
    `).run(
      '<environment_context>injected title</environment_context>',
      'safe prompt',
      '<codex_internal_context>injected preview</codex_internal_context>',
      threadId,
    )
    writableMetadata.close()
    const sanitizedSession = getSession(threadId)
    assert.equal(sanitizedSession.title, 'safe prompt')
    assert.equal(sanitizedSession.snippet, 'safe prompt')
    assert.equal(latestPrompt().title, 'safe prompt')

    const expectedRollout = path.join(dir, 'expected.jsonl')
    const unrelatedRollout = path.join(dir, 'unrelated.jsonl')
    const correlationId = 'ui-my-cli-12345678-1234-1234-1234-123456789abc'
    writeFileSync(expectedRollout, JSON.stringify({
      type: 'session_meta',
      payload: { id: 'expected', originator: correlationId, base_instructions: 'x'.repeat(20000) },
    }))
    writeFileSync(unrelatedRollout, JSON.stringify({
      type: 'session_meta',
      payload: { id: 'unrelated', originator: 'codex_cli_rs' },
    }))
    const writable = new Database(statePath)
    writable.prepare(`
      INSERT INTO threads (id, rollout_path, created_at, updated_at, source, cwd, title)
      VALUES (?, ?, ?, ?, 'cli', '/repo', '')
    `).run('expected', expectedRollout, 100, 100)
    writable.prepare(`
      INSERT INTO threads (id, rollout_path, created_at, updated_at, source, cwd, title)
      VALUES (?, ?, ?, ?, 'cli', '/repo', '')
    `).run('unrelated', unrelatedRollout, 200, 200)
    writable.close()
    assert.equal(findNewSessionInDir('/repo', new Set(), { correlationId }), 'expected')
    assert.equal(findNewSessionInDir('/repo', new Set(), {
      correlationId: 'ui-my-cli-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    }), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CODEX_HOME
    delete process.env.CODEX_STATE_DB_PATH
    delete process.env.UI_MY_CLI_DB_PATH
  }
})

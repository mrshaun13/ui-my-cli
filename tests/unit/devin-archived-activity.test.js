const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

test('archived Devin status uses the newest tail message deterministically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-my-cli-devin-'));
  const sessionsPath = path.join(root, 'sessions.db');
  const dashboardPath = path.join(root, 'dashboard.db');
  const db = new Database(sessionsPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      working_directory TEXT,
      model TEXT,
      created_at INTEGER,
      last_activity_at INTEGER,
      title TEXT
    );
    CREATE TABLE message_nodes (
      row_id INTEGER PRIMARY KEY,
      session_id TEXT,
      chat_message TEXT
    );
  `);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO sessions (id, working_directory, model, created_at, last_activity_at, title)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('session-1', '/repo', 'devin', now - 600, now - 120, 'Archived session');
  const insertMessage = db.prepare(`
    INSERT INTO message_nodes (row_id, session_id, chat_message)
    VALUES (?, ?, ?)
  `);
  insertMessage.run(1, 'session-1', JSON.stringify({ role: 'tool', content: 'older tool result' }));
  insertMessage.run(2, 'session-1', JSON.stringify({ role: 'assistant', content: 'The work is complete.' }));
  db.close();
  process.env.DEVIN_DB_PATH = sessionsPath;
  process.env.DEVIN_DASHBOARD_DB_PATH = dashboardPath;

  const store = require('../../server/providers/devin/store');
  try {
    store.hideSession('session-1');
    const [session] = store.listArchivedSessions();
    assert.equal(session.status, 'archived');
    assert.equal(session.activityStatus, 'finished');
  } finally {
    delete process.env.DEVIN_DB_PATH;
    delete process.env.DEVIN_DASHBOARD_DB_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

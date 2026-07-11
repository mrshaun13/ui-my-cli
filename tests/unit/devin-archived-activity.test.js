const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

test('Devin status uses deterministic tails and preserves unresolved tool activity', () => {
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
  db.prepare(`
    INSERT INTO sessions (id, working_directory, model, created_at, last_activity_at, title)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('session-2', '/repo', 'devin', now - 1800, now - 1200, 'Long-running tool');
  db.prepare(`
    INSERT INTO sessions (id, working_directory, model, created_at, last_activity_at, title)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('session-3', '/repo', 'devin', now - 1800, now - 1200, 'Completed tool');
  db.prepare(`
    INSERT INTO sessions (id, working_directory, model, created_at, last_activity_at, title)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('session-4', '/repo', 'devin', now - 172800, now - 90000, 'Abandoned tool');
  db.prepare(`
    INSERT INTO sessions (id, working_directory, model, created_at, last_activity_at, title)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('session-5', '/repo', 'devin', now - 1800, now - 1200, 'Previous turn tool');
  const insertMessage = db.prepare(`
    INSERT INTO message_nodes (row_id, session_id, chat_message)
    VALUES (?, ?, ?)
  `);
  insertMessage.run(1, 'session-1', JSON.stringify({ role: 'tool', content: 'older tool result' }));
  insertMessage.run(2, 'session-1', JSON.stringify({ role: 'assistant', content: 'The work is complete.' }));
  insertMessage.run(3, 'session-2', JSON.stringify({ role: 'assistant', content: 'Starting work.' }));
  insertMessage.run(4, 'session-2', JSON.stringify({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'long-tool', function: { name: 'long_running_tool' } }],
  }));
  insertMessage.run(5, 'session-3', JSON.stringify({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'completed-tool', function: { name: 'completed_tool' } }],
  }));
  insertMessage.run(6, 'session-3', JSON.stringify({
    role: 'tool',
    tool_call_id: 'completed-tool',
    content: 'done',
  }));
  insertMessage.run(7, 'session-4', JSON.stringify({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'abandoned-tool', function: { name: 'abandoned_tool' } }],
  }));
  for (let rowId = 8; rowId <= 14; rowId++) {
    insertMessage.run(rowId, 'session-2', JSON.stringify({
      role: 'assistant',
      content: `Progress update ${rowId}`,
    }));
  }
  insertMessage.run(15, 'session-5', JSON.stringify({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'previous-tool', function: { name: 'previous_turn_tool' } }],
  }));
  insertMessage.run(16, 'session-5', JSON.stringify({ role: 'user', content: 'Start a new turn.' }));
  insertMessage.run(17, 'session-5', JSON.stringify({ role: 'assistant', content: 'The new turn is complete.' }));
  db.close();
  process.env.DEVIN_DB_PATH = sessionsPath;
  process.env.DEVIN_DASHBOARD_DB_PATH = dashboardPath;

  const store = require('../../server/providers/devin/store');
  try {
    store.hideSession('session-1');
    const [session] = store.listArchivedSessions();
    assert.equal(session.status, 'archived');
    assert.equal(session.activityStatus, 'finished');
    const visible = store.listSessions();
    assert.equal(visible.length, 4);
    assert.equal(visible.find(candidate => candidate.id === 'session-2')?.status, 'idle');
    assert.equal(visible.find(candidate => candidate.id === 'session-3')?.status, 'idle');
    assert.equal(visible.find(candidate => candidate.id === 'session-4')?.status, 'idle');
    assert.equal(visible.find(candidate => candidate.id === 'session-5')?.status, 'active');
    assert.equal(store.isSessionInFlight('session-2'), true);
    assert.equal(store.isSessionInFlight('session-3'), false);
    assert.equal(store.isSessionInFlight('session-4'), false);
    assert.equal(store.isSessionInFlight('session-5'), false);
    assert.deepEqual(store.listInFlightSessionIds(visible), new Set(['session-2']));
  } finally {
    delete process.env.DEVIN_DB_PATH;
    delete process.env.DEVIN_DASHBOARD_DB_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Dashboard-owned metadata for local Codex sessions.
 *
 * Codex internal SQLite tables are read-only to this app. Titles and other
 * UI-only data live here instead.
 */

const Database = require('better-sqlite3');
const { resolveDashboardDbPath } = require('./codex-paths');

let db;

function getDb() {
  if (db) return db;
  db = new Database(resolveDashboardDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_titles (
      session_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hidden_sessions (
      session_id TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL
    )
  `);
  return db;
}

function titleOverrides() {
  const rows = getDb().prepare('SELECT session_id, title FROM session_titles').all();
  return new Map(rows.map(row => [row.session_id, row.title]));
}

function getTitle(sessionId) {
  const row = getDb().prepare('SELECT title FROM session_titles WHERE session_id = ?').get(sessionId);
  return row?.title || null;
}

function setTitle(sessionId, title) {
  const trimmed = (title || '').trim();
  if (!trimmed) {
    getDb().prepare('DELETE FROM session_titles WHERE session_id = ?').run(sessionId);
    return { id: sessionId, title: null };
  }
  getDb().prepare(`
    INSERT INTO session_titles (session_id, title, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      title = excluded.title,
      updated_at = excluded.updated_at
  `).run(sessionId, trimmed, Math.floor(Date.now() / 1000));
  return { id: sessionId, title: trimmed };
}

function hiddenSessions() {
  const rows = getDb().prepare('SELECT session_id FROM hidden_sessions').all();
  return new Set(rows.map(row => row.session_id));
}

function hideSession(sessionId) {
  getDb().prepare(`
    INSERT INTO hidden_sessions (session_id, updated_at)
    VALUES (?, ?)
    ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(sessionId, Math.floor(Date.now() / 1000));
  return { id: sessionId, archived: true };
}

function restoreSession(sessionId) {
  getDb().prepare('DELETE FROM hidden_sessions WHERE session_id = ?').run(sessionId);
  return { id: sessionId, archived: false };
}

function isHidden(sessionId) {
  return !!getDb().prepare('SELECT 1 FROM hidden_sessions WHERE session_id = ?').get(sessionId);
}

module.exports = {
  titleOverrides,
  getTitle,
  setTitle,
  hiddenSessions,
  hideSession,
  restoreSession,
  isHidden,
};

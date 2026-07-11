const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

test('Devin pending sessions correlate only through their own process log', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-my-cli-devin-correlation-'));
  const sessionsPath = path.join(root, 'sessions.db');
  const logsPath = path.join(root, 'logs');
  fs.mkdirSync(logsPath);
  const db = new Database(sessionsPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      working_directory TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  const startedAt = Date.now() - 1_000;
  const createdAt = Math.floor(startedAt / 1000);
  const insert = db.prepare('INSERT INTO sessions (id, working_directory, created_at) VALUES (?, ?, ?)');
  insert.run('owned-session', '/repo', createdAt);
  insert.run('unrelated-session', '/repo', createdAt + 20);
  insert.run('unique-but-unowned', '/unique', createdAt + 30);
  insert.run('wrong-directory', '/other', createdAt);
  db.close();
  fs.writeFileSync(
    path.join(logsPath, 'devin_20260710-120000_4242.log'),
    'INFO chisel_agent::session_db: Created new session: owned-session\n');
  fs.writeFileSync(
    path.join(logsPath, 'devin_20260710-120001_5252.log'),
    'INFO chisel_agent::session_db: Created new session: wrong-directory\n');

  process.env.DEVIN_DB_PATH = sessionsPath;
  const store = require('../../server/providers/devin/store');
  try {
    assert.equal(
      store.findNewSessionInDir('/repo', new Set(), { processId: 4242, startedAt }),
      'owned-session');
    assert.equal(
      store.findNewSessionInDir('/repo', new Set(), { processId: 9999, startedAt }),
      null);
    assert.equal(
      store.findNewSessionInDir('/unique', new Set(), { processId: 9999, startedAt }),
      null);
    assert.equal(
      store.findNewSessionInDir('/repo', new Set(['owned-session']), { processId: 4242, startedAt }),
      null);
    assert.equal(
      store.findNewSessionInDir('/repo', new Set(), { processId: 5252, startedAt }),
      null);
  } finally {
    delete process.env.DEVIN_DB_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Devin PTYs launch the provider directly with structured arguments', () => {
  const provider = require('../../server/providers/devin');
  assert.deepEqual(provider.buildCommand(null), {
    command: 'devin',
    args: ['--respect-workspace-trust', 'false'],
  });
  assert.deepEqual(provider.buildCommand('session with shell syntax; $(ignored)'), {
    command: 'devin',
    args: ['--resume', 'session with shell syntax; $(ignored)', '--respect-workspace-trust', 'false'],
  });
});

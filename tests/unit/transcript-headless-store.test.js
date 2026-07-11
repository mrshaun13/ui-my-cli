const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('headless sessions expire abandoned runs without hiding recent activity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-my-cli-headless-'));
  const sessionsDir = path.join(root, 'sessions');
  for (const [sessionName, startedAt] of [
    ['active-session', new Date().toISOString()],
    ['abandoned-session', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()],
  ]) {
    const sessionDir = path.join(sessionsDir, sessionName);
    const runDir = path.join(sessionDir, 'runs', 'run-1');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify({
      session_name: sessionName,
      current_run_id: 'run-1',
    }));
    fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
      run_id: 'run-1',
      started_at: startedAt,
      runtime_metadata: { agent_id: 'codex' },
    }));
    fs.writeFileSync(path.join(runDir, 'prompt.txt'), 'Continue processing');
  }
  process.env.TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR = sessionsDir;
  process.env.UI_MY_CLI_DB_PATH = path.join(root, 'dashboard.sqlite');

  const store = require('../../server/transcript-headless-store');
  try {
    store.hideSession('tp:active-session');
    store.hideSession('tp:abandoned-session');
    const sessions = new Map(store.listArchivedSessions().map(session => [session.id, session]));
    assert.equal(sessions.get('tp:active-session').status, 'archived');
    assert.equal(sessions.get('tp:active-session').activityStatus, 'active');
    assert.equal(sessions.get('tp:abandoned-session').status, 'archived');
    assert.equal(sessions.get('tp:abandoned-session').activityStatus, 'idle');
  } finally {
    delete process.env.TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR;
    delete process.env.UI_MY_CLI_DB_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('archived headless sessions preserve their underlying activity status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-my-cli-headless-'));
  const sessionsDir = path.join(root, 'sessions');
  const sessionDir = path.join(sessionsDir, 'active-session');
  const runDir = path.join(sessionDir, 'runs', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify({
    session_name: 'active-session',
    current_run_id: 'run-1',
  }));
  fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
    run_id: 'run-1',
    started_at: new Date().toISOString(),
    runtime_metadata: { agent_id: 'codex' },
  }));
  fs.writeFileSync(path.join(runDir, 'prompt.txt'), 'Continue processing');
  process.env.TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR = sessionsDir;
  process.env.UI_MY_CLI_DB_PATH = path.join(root, 'dashboard.sqlite');

  const store = require('../../server/transcript-headless-store');
  try {
    store.hideSession('tp:active-session');
    const [session] = store.listArchivedSessions();
    assert.equal(session.status, 'archived');
    assert.equal(session.activityStatus, 'active');
  } finally {
    delete process.env.TRANSCRIPT_PIPELINE_HEADLESS_SESSIONS_DIR;
    delete process.env.UI_MY_CLI_DB_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const assert = require('node:assert/strict');
const test = require('node:test');
const { nativeUpdateActivity } = require('../../server/native-update-activity');

test('native update activity counts active sessions across every provider', () => {
  const result = nativeUpdateActivity([
    { id: 'codex', listSessions: () => [{ status: 'active' }, { status: 'finished' }] },
    { id: 'devin', listSessions: () => [{ status: 'ACTIVE' }, { status: 'idle' }] },
  ]);
  assert.equal(result.blockingSessions, 2);
});

test('native update activity fails closed on provider read errors', () => {
  assert.throws(() => nativeUpdateActivity([
    { id: 'codex', listSessions: () => { throw new Error('state unavailable'); } },
  ]), /state unavailable/);
  assert.throws(() => nativeUpdateActivity([
    { id: 'devin', listSessions: () => null },
  ]), /invalid session list/);
  assert.throws(() => nativeUpdateActivity([
    { id: 'devin', listSessions: () => [{ status: 'unknown' }] },
  ]), /invalid session status/);
});

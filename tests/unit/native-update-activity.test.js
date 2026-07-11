const assert = require('node:assert/strict');
const test = require('node:test');
const { nativeUpdateActivity } = require('../../server/native-update-activity');

test('native update activity counts active sessions across every provider', () => {
  const result = nativeUpdateActivity([
    { id: 'codex', availability: () => ({ available: true }), listSessions: () => [{ status: 'active' }, { status: 'finished' }] },
    { id: 'devin', availability: () => ({ available: true }), listSessions: () => [{ status: 'ACTIVE' }, { status: 'idle' }] },
  ]);
  assert.equal(result.blockingSessions, 2);
});

test('native update activity skips unavailable providers', () => {
  const result = nativeUpdateActivity([
    {
      id: 'codex',
      availability: () => ({ available: false, error: 'state unavailable' }),
      listSessions: () => { throw new Error('must not read unavailable provider'); },
    },
    { id: 'devin', availability: () => ({ available: true }), listSessions: () => [{ status: 'active' }] },
  ]);
  assert.equal(result.blockingSessions, 1);
});

test('native update activity blocks a quiet session with an in-flight provider turn', () => {
  const checked = [];
  const result = nativeUpdateActivity([
    {
      id: 'codex',
      listSessions: () => [{ id: 'quiet-turn', status: 'finished' }],
      isSessionInFlight: id => {
        checked.push(id);
        return true;
      },
    },
  ]);
  assert.deepEqual(checked, ['quiet-turn']);
  assert.equal(result.blockingSessions, 1);
});

test('native update activity includes archived sessions once', () => {
  const checked = [];
  const result = nativeUpdateActivity([
    {
      id: 'codex',
      listSessions: () => [
        { id: 'visible', status: 'finished' },
        { id: 'duplicate', status: 'active' },
      ],
      listArchivedSessions: () => [
        { id: 'archived', status: 'archived' },
        { id: 'duplicate', status: 'archived' },
      ],
      isSessionInFlight: id => {
        checked.push(id);
        return id === 'archived';
      },
    },
  ]);
  assert.deepEqual(checked, ['visible', 'duplicate', 'archived']);
  assert.equal(result.blockingSessions, 2);
});

test('native update activity blocks archived provider sessions with active underlying status', () => {
  const result = nativeUpdateActivity([
    {
      id: 'devin',
      listSessions: () => [],
      listArchivedSessions: () => [
        { id: 'active-archived', status: 'archived', activityStatus: 'active' },
        { id: 'idle-archived', status: 'archived', activityStatus: 'idle' },
      ],
    },
  ]);
  assert.equal(result.blockingSessions, 1);
});

test('native update activity fails closed on provider read errors', () => {
  assert.throws(() => nativeUpdateActivity([
    { id: 'codex', listSessions: () => { throw new Error('state unavailable'); } },
  ]), /state unavailable/);
  assert.throws(() => nativeUpdateActivity([
    { id: 'devin', listSessions: () => null },
  ]), /invalid session list/);
  assert.throws(() => nativeUpdateActivity([
    { id: 'devin', listSessions: () => [], listArchivedSessions: () => null },
  ]), /invalid session list/);
  assert.throws(() => nativeUpdateActivity([
    { id: 'devin', listSessions: () => [{ status: 'unknown' }] },
  ]), /invalid session status/);
  assert.throws(() => nativeUpdateActivity([
    { id: 'codex', availability: () => { throw new Error('availability failed'); }, listSessions: () => [] },
  ]), /availability failed/);
  assert.throws(() => nativeUpdateActivity([
    { id: 'codex', listSessions: () => [{ id: 'bad', status: 'finished' }], isSessionInFlight: () => null },
  ]), /invalid in-flight session state/);
  assert.throws(() => nativeUpdateActivity([
    { id: 'devin', listSessions: () => [], listArchivedSessions: () => [{ id: 'hidden', status: 'archived' }] },
  ]), /invalid archived activity status/);
});

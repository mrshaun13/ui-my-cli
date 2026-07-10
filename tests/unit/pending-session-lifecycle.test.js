const assert = require('node:assert/strict');
const test = require('node:test');
const { pendingSessionDisposition } = require('../../server/pending-session-lifecycle');

test('pending metadata polling never expires a live PTY', () => {
  assert.equal(pendingSessionDisposition(null, true), 'continue');
  assert.equal(pendingSessionDisposition('', true), 'continue');
});

test('pending metadata polling rekeys a discovered session', () => {
  assert.equal(pendingSessionDisposition('session-123', true), 'rekey');
  assert.equal(pendingSessionDisposition('session-123', false), 'rekey');
});

test('pending metadata expires only after its PTY exits', () => {
  assert.equal(pendingSessionDisposition(null, false), 'expire');
});

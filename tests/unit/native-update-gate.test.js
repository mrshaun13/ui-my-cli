const assert = require('node:assert/strict');
const test = require('node:test');
const { NativeUpdateGate } = require('../../server/native-update-gate');

test('native update shutdown waits for in-flight session mutations', () => {
  const gate = new NativeUpdateGate();
  const completeMutation = gate.tryBeginMutation();

  assert.equal(typeof completeMutation, 'function');
  assert.equal(gate.tryBeginShutdown(), false);
  assert.equal(gate.shutdownPending, false);

  completeMutation();
  assert.equal(gate.tryBeginShutdown(), true);
  assert.equal(gate.shutdownPending, true);
  assert.equal(gate.tryBeginMutation(), null);
});

test('native update shutdown can be cancelled after readiness refusal', () => {
  const gate = new NativeUpdateGate();

  assert.equal(gate.tryBeginShutdown(), true);
  gate.cancelShutdown();

  const completeMutation = gate.tryBeginMutation();
  assert.equal(typeof completeMutation, 'function');
  completeMutation();
});

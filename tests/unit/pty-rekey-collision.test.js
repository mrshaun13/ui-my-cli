const assert = require('node:assert/strict');
const test = require('node:test');
const {
  markPtyRekeyCollision,
  terminateDetachedCollision,
} = require('../../server/pty-manager');

test('rekey collision retains both terminals until the pending client detaches', () => {
  const frames = [];
  let pendingKills = 0;
  let canonicalKills = 0;
  const client = {
    readyState: 1,
    send: frame => frames.push(JSON.parse(frame)),
  };
  const pending = {
    clients: new Set([client]),
    pty: { kill: () => pendingKills++ },
  };
  const canonical = {
    clients: new Set(),
    pty: { kill: () => canonicalKills++ },
  };

  assert.equal(markPtyRekeyCollision(pending, canonical, 'real-123'), true);
  assert.equal(pending.collisionRealId, 'real-123');
  assert.equal(terminateDetachedCollision(pending), false);
  assert.equal(pendingKills, 0);
  assert.equal(canonicalKills, 0);
  assert.match(frames[0].data, /canonical terminal/);
  assert.match(frames[0].data, /close after detaching/);

  pending.clients.clear();
  assert.equal(terminateDetachedCollision(pending), true);
  assert.equal(pendingKills, 1);
  assert.equal(canonicalKills, 0);
});

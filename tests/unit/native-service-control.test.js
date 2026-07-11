const assert = require('node:assert/strict');
const test = require('node:test');
const {
  matchesNativeControlCapability,
  validNativeControlCapability,
} = require('../../server/native-service-control');

const capability = '0123456789ABCDEF'.repeat(4);

test('native service control accepts only the exact generated capability shape', () => {
  assert.equal(validNativeControlCapability(capability), true);
  assert.equal(validNativeControlCapability(capability.toLowerCase()), false);
  assert.equal(validNativeControlCapability(capability.slice(1)), false);
  assert.equal(matchesNativeControlCapability(capability, capability), true);
  assert.equal(matchesNativeControlCapability(capability, 'F'.repeat(64)), false);
  assert.equal(matchesNativeControlCapability(capability, undefined), false);
});

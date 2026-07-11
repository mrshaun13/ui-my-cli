'use strict';

const { timingSafeEqual } = require('crypto');

const CONTROL_CAPABILITY_PATTERN = /^[A-F0-9]{64}$/;

function validNativeControlCapability(value) {
  return typeof value === 'string' && CONTROL_CAPABILITY_PATTERN.test(value);
}

function matchesNativeControlCapability(expected, supplied) {
  if (!validNativeControlCapability(expected) || !validNativeControlCapability(supplied)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected, 'ascii'),
    Buffer.from(supplied, 'ascii'));
}

module.exports = {
  matchesNativeControlCapability,
  validNativeControlCapability,
};

/** Codex control-plane request compatibility and best-effort startup helpers. */

'use strict';

function wantsCodexControlPlane(providerId, request = {}) {
  if (providerId !== 'codex') return false;
  return request.controlPlane === true
    || request.controlPlane === '1'
    || request.adaptive === true
    || request.adaptive === '1';
}

async function tryStartCodexControlPlane(ensureStarted, onUnavailable = () => {}) {
  try {
    return await ensureStarted();
  } catch (error) {
    onUnavailable(error);
    return null;
  }
}

module.exports = {
  wantsCodexControlPlane,
  tryStartCodexControlPlane,
};

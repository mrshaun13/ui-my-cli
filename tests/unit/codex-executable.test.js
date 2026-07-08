const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveCodexExecutable } = require('../../server/providers/codex/executable');

test('Codex executable resolution keeps the explicit override', () => {
  assert.equal(resolveCodexExecutable({
    configuredPath: '/custom/codex',
    executableExists: () => false,
  }), '/custom/codex');
});

test('Codex executable resolution finds Homebrew outside a Finder PATH', () => {
  const available = new Set(['/opt/homebrew/bin/codex']);
  assert.equal(resolveCodexExecutable({
    configuredPath: '',
    pathValue: '/usr/bin:/bin',
    homeDirectory: '/Users/tester',
    platform: 'darwin',
    executableExists: available.has.bind(available),
    listDirectories: () => [],
  }), '/opt/homebrew/bin/codex');
});

test('Codex executable resolution finds the newest nvm installation', () => {
  const available = new Set(['/Users/tester/.nvm/versions/node/v24.1.0/bin/codex']);
  assert.equal(resolveCodexExecutable({
    configuredPath: '',
    pathValue: '/usr/bin',
    homeDirectory: '/Users/tester',
    platform: 'darwin',
    executableExists: available.has.bind(available),
    listDirectories: () => [
      '/Users/tester/.nvm/versions/node/v22.9.0',
      '/Users/tester/.nvm/versions/node/v24.1.0',
    ],
  }), '/Users/tester/.nvm/versions/node/v24.1.0/bin/codex');
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renameCodexSession } = require('../../server/providers/codex/rename');

function dependencies(overrides = {}) {
  return {
    appServer: { request: async () => ({}) },
    isTranscriptHeadlessId: id => id.startsWith('tp:'),
    setTranscriptTitle: (id, title) => ({ id, title }),
    resolveNativeTitle: (id, title) => ({ id, title: title.trim() }),
    clearLegacyTitle: () => {},
    ...overrides,
  };
}

test('native Codex rename uses the durable app-server thread name method', async () => {
  const calls = [];
  const cleared = [];
  const result = await renameCodexSession('thread-123', 'Durable title', dependencies({
    appServer: {
      request: async (method, params) => calls.push({ method, params }),
    },
    clearLegacyTitle: id => cleared.push(id),
  }));

  assert.deepEqual(calls, [{
    method: 'thread/name/set',
    params: { threadId: 'thread-123', name: 'Durable title' },
  }]);
  assert.deepEqual(cleared, ['thread-123']);
  assert.deepEqual(result, { id: 'thread-123', title: 'Durable title' });
});

test('transcript rename stays in dashboard metadata and does not start app-server', async () => {
  let appServerCalled = false;
  const result = await renameCodexSession('tp:run-1', 'Transcript title', dependencies({
    appServer: { request: async () => { appServerCalled = true; } },
    setTranscriptTitle: (id, title) => ({ id, title: title.toUpperCase() }),
  }));

  assert.equal(appServerCalled, false);
  assert.deepEqual(result, { id: 'tp:run-1', title: 'TRANSCRIPT TITLE' });
});

test('unsupported Codex rename fails clearly without clearing legacy metadata', async () => {
  let cleared = false;
  const methodError = Object.assign(new Error('Method not found'), { code: -32601 });

  await assert.rejects(
    renameCodexSession('thread-123', 'New title', dependencies({
      appServer: { request: async () => { throw methodError; } },
      clearLegacyTitle: () => { cleared = true; },
    })),
    error => error.code === 'CODEX_RENAME_UNSUPPORTED'
      && /Update Codex/.test(error.message),
  );
  assert.equal(cleared, false);
});

test('legacy metadata cleanup cannot turn a successful durable rename into a failure', async () => {
  const cleanupErrors = [];
  const result = await renameCodexSession('thread-123', 'Durable title', dependencies({
    clearLegacyTitle: () => { throw new Error('dashboard metadata is locked'); },
    onCleanupError: error => cleanupErrors.push(error.message),
  }));

  assert.deepEqual(result, { id: 'thread-123', title: 'Durable title' });
  assert.deepEqual(cleanupErrors, ['dashboard metadata is locked']);
});

'use strict';

const METHOD_NOT_FOUND = -32601;

async function renameCodexSession(id, title, dependencies) {
  const {
    appServer,
    isTranscriptHeadlessId,
    setTranscriptTitle,
    resolveNativeTitle,
    clearLegacyTitle,
  } = dependencies;

  if (isTranscriptHeadlessId(id)) return setTranscriptTitle(id, title);
  if (!appServer || typeof appServer.request !== 'function') {
    throw new Error('Codex app-server is required to rename native Codex sessions');
  }

  const result = resolveNativeTitle(id, title);
  try {
    await appServer.request('thread/name/set', {
      threadId: id,
      name: result.title,
    });
  } catch (error) {
    if (error?.code === METHOD_NOT_FOUND) {
      const unsupported = new Error(
        'This Codex version does not support durable session renaming. Update Codex and try again.');
      unsupported.code = 'CODEX_RENAME_UNSUPPORTED';
      throw unsupported;
    }
    throw error;
  }

  try {
    clearLegacyTitle(id);
  } catch (error) {
    dependencies.onCleanupError?.(error, id);
  }
  return result;
}

module.exports = { renameCodexSession };

const assert = require('node:assert/strict');
const test = require('node:test');

test('browser session-title validation matches the server contract', async () => {
  const {
    MAXIMUM_SESSION_TITLE,
    sessionTitleValidationError,
    validateSessionTitle,
  } = await import('../../client/src/lib/sessionTitles.js');

  assert.equal(validateSessionTitle('  Durable session title  '), 'Durable session title');
  assert.equal(validateSessionTitle('🙂'.repeat(MAXIMUM_SESSION_TITLE)), '🙂'.repeat(MAXIMUM_SESSION_TITLE));
  assert.throws(() => validateSessionTitle('x'.repeat(MAXIMUM_SESSION_TITLE + 1)), /1-160 characters/);
  assert.throws(() => validateSessionTitle('bad\nname'), /control characters/);
  assert.throws(() => validateSessionTitle('   '), /1-160 characters/);
  assert.equal(sessionTitleValidationError('Valid title'), '');
  assert.match(sessionTitleValidationError('bad\nname'), /control characters/);
});

test('invalid browser rename input is rejected before submission', async () => {
  const { renameSessionTitle } = await import('../../client/src/lib/sessionTitles.js');
  let submitted = false;

  await assert.rejects(
    renameSessionTitle('/rename', 'x'.repeat(161), async () => {
      submitted = true;
    }),
    /1-160 characters/,
  );
  assert.equal(submitted, false);
});

test('browser renames return only the canonical server title', async () => {
  const { renameSessionTitle } = await import('../../client/src/lib/sessionTitles.js');
  const requests = [];
  const title = await renameSessionTitle('/rename', '  Requested title  ', async (endpoint, options) => {
    requests.push({ endpoint, options });
    return {
      ok: true,
      json: async () => ({ title: 'Canonical server title' }),
    };
  });

  assert.equal(title, 'Canonical server title');
  assert.equal(requests[0].endpoint, '/rename');
  assert.deepEqual(JSON.parse(requests[0].options.body), { title: 'Requested title' });
});

test('browser renames surface authoritative server errors', async () => {
  const { renameSessionTitle } = await import('../../client/src/lib/sessionTitles.js');

  await assert.rejects(
    renameSessionTitle('/rename', 'Valid title', async () => ({
      ok: false,
      json: async () => ({ error: 'Rename was rejected' }),
    })),
    /Rename was rejected/,
  );
});

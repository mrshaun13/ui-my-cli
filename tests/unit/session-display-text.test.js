const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAXIMUM_SESSION_TITLE,
  validateSessionTitle,
  sessionCanonicalTitle,
  sessionDisplayTitle,
  isSyntheticUserMessage,
} = require('../../server/session-display-text');

test('session display titles are single-line and bounded', () => {
  const title = sessionDisplayTitle(`A long title\n\n${'word '.repeat(80)}`);
  assert.equal(title.includes('\n'), false);
  assert.equal(title.length, MAXIMUM_SESSION_TITLE);
  assert.equal(title.endsWith('…'), true);
});

test('session display title preserves a normal explicit title', () => {
  assert.equal(sessionDisplayTitle('Review PR 22 conflicts'), 'Review PR 22 conflicts');
  assert.equal(sessionDisplayTitle('🙂'.repeat(MAXIMUM_SESSION_TITLE)), '🙂'.repeat(MAXIMUM_SESSION_TITLE));
  assert.equal(
    sessionDisplayTitle(`${'x'.repeat(MAXIMUM_SESSION_TITLE - 1)}🙂`),
    `${'x'.repeat(MAXIMUM_SESSION_TITLE - 1)}🙂`,
  );
  assert.equal(
    sessionDisplayTitle(`${'x'.repeat(MAXIMUM_SESSION_TITLE)}🙂`),
    `${'x'.repeat(MAXIMUM_SESSION_TITLE - 1)}…`,
  );
});

test('canonical session titles have a 160-character control-free limit', () => {
  assert.equal(validateSessionTitle('  Durable session title  '), 'Durable session title');
  assert.equal(validateSessionTitle('🙂'.repeat(MAXIMUM_SESSION_TITLE)), '🙂'.repeat(MAXIMUM_SESSION_TITLE));
  assert.throws(() => validateSessionTitle('x'.repeat(MAXIMUM_SESSION_TITLE + 1)), /1-160 characters/);
  assert.throws(() => validateSessionTitle('bad\nname'), /control characters/);
});

test('canonical session titles are not converted to display text', () => {
  const title = 'Preserve  internal   spaces';
  assert.equal(sessionCanonicalTitle(title), title);
  assert.equal(sessionCanonicalTitle('x'.repeat(MAXIMUM_SESSION_TITLE + 1)).endsWith('…'), true);
});

test('synthetic Codex context is not treated as a user prompt', () => {
  assert.equal(isSyntheticUserMessage('<codex_internal_context source="goal">\nContinue'), true);
  assert.equal(isSyntheticUserMessage('<environment_context>\n<cw>/tmp</cw>'), true);
  assert.equal(isSyntheticUserMessage('# AGENTS.md instructions for /tmp\n<INSTRUCTIONS>'), true);
  assert.equal(isSyntheticUserMessage('Please review AGENTS.md before changing code.'), false);
});

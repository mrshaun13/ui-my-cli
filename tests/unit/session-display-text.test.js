const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAXIMUM_SESSION_TITLE,
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
});

test('synthetic Codex context is not treated as a user prompt', () => {
  assert.equal(isSyntheticUserMessage('<codex_internal_context source="goal">\nContinue'), true);
  assert.equal(isSyntheticUserMessage('<environment_context>\n<cw>/tmp</cw>'), true);
  assert.equal(isSyntheticUserMessage('# AGENTS.md instructions for /tmp\n<INSTRUCTIONS>'), true);
  assert.equal(isSyntheticUserMessage('Please review AGENTS.md before changing code.'), false);
});

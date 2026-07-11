'use strict';

/**
 * Normalizes user-facing session text so sidebar and native layouts receive
 * bounded single-line titles and omit injected Codex context envelopes from
 * user-prompt metadata.
 */

const MAXIMUM_SESSION_TITLE = 160;
const CONTROL_CHARACTER_RE = /\p{Cc}/u;

function validateSessionTitle(value) {
  if (typeof value !== 'string') {
    throw new Error('title must be a string');
  }
  const title = value.trim();
  if (!title || Array.from(title).length > MAXIMUM_SESSION_TITLE || CONTROL_CHARACTER_RE.test(title)) {
    throw new Error(`title must be 1-${MAXIMUM_SESSION_TITLE} characters without control characters`);
  }
  return title;
}

function singleLine(value) {
  return String(value || '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function sessionDisplayTitle(value, fallback = 'Untitled session') {
  const normalized = singleLine(value) || singleLine(fallback) || 'Untitled session';
  const characters = Array.from(normalized);
  if (characters.length <= MAXIMUM_SESSION_TITLE) return normalized;
  return `${characters.slice(0, MAXIMUM_SESSION_TITLE - 1).join('').trimEnd()}…`;
}

function sessionCanonicalTitle(value, fallback = 'Untitled session') {
  const title = String(value || '');
  if (title.trim() && Array.from(title).length <= MAXIMUM_SESSION_TITLE && !CONTROL_CHARACTER_RE.test(title)) {
    return title;
  }
  return sessionDisplayTitle(title, fallback);
}

function isSyntheticUserMessage(value) {
  const text = String(value || '').trimStart();
  return text.startsWith('<codex_internal_context')
    || text.startsWith('<environment_context>')
    || (text.startsWith('# AGENTS.md instructions for ') && text.includes('<INSTRUCTIONS>'));
}

module.exports = {
  MAXIMUM_SESSION_TITLE,
  validateSessionTitle,
  sessionCanonicalTitle,
  sessionDisplayTitle,
  isSyntheticUserMessage,
};

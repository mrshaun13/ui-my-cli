'use strict';

const MAXIMUM_SESSION_TITLE = 160;

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sessionDisplayTitle(value, fallback = 'Untitled session') {
  const normalized = singleLine(value) || singleLine(fallback) || 'Untitled session';
  if (normalized.length <= MAXIMUM_SESSION_TITLE) return normalized;
  return `${normalized.slice(0, MAXIMUM_SESSION_TITLE - 1).trimEnd()}…`;
}

function isSyntheticUserMessage(value) {
  const text = String(value || '').trimStart();
  return text.startsWith('<codex_internal_context')
    || text.startsWith('<environment_context>')
    || (text.startsWith('# AGENTS.md instructions for ') && text.includes('<INSTRUCTIONS>'));
}

module.exports = {
  MAXIMUM_SESSION_TITLE,
  sessionDisplayTitle,
  isSyntheticUserMessage,
};

/**
 * Codex exposes guardian/subagent review threads as normal local threads.
 * The v1 retrofit keeps them out of the main session list and returns an empty
 * per-session subagent timeline until a dedicated linked-thread view is added.
 */

function extractSubagents() {
  return [];
}

function countSubagents() {
  return 0;
}

function countAllSubagents() {
  return 0;
}

function sessionsWithSubagents() {
  return new Set();
}

module.exports = { extractSubagents, countSubagents, countAllSubagents, sessionsWithSubagents };

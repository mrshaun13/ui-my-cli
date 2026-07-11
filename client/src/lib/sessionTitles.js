export const MAXIMUM_SESSION_TITLE = 160
export const SESSION_TITLE_RECONCILIATION_MS = 12_000
const CONTROL_CHARACTER_RE = /\p{Cc}/u

export function validateSessionTitle(value) {
  if (typeof value !== 'string') {
    throw new Error('title must be a string')
  }

  const title = value.trim()
  if (!title || Array.from(title).length > MAXIMUM_SESSION_TITLE || CONTROL_CHARACTER_RE.test(title)) {
    throw new Error(`title must be 1-${MAXIMUM_SESSION_TITLE} characters without control characters`)
  }
  return title
}

export function sessionTitleValidationError(value) {
  try {
    validateSessionTitle(value)
    return ''
  } catch (error) {
    return error.message
  }
}

export async function renameSessionTitle(endpoint, value, fetchImpl = fetch) {
  const title = validateSessionTitle(value)
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.error || 'Failed to rename session')
  }
  return validateSessionTitle(result.title)
}

export function reconcileSessionTitle(sessionId, incomingTitle, pendingRenames, now = Date.now()) {
  const pending = pendingRenames.get(sessionId)
  if (!pending) return incomingTitle
  if (now >= pending.expiresAt) {
    pendingRenames.delete(sessionId)
    return incomingTitle
  }
  return pending.title
}

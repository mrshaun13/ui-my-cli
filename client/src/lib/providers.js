export const DEFAULT_PROVIDER_ID = 'codex'

export function providerApiPath(providerId, path) {
  const provider = encodeURIComponent(providerId || DEFAULT_PROVIDER_ID)
  const cleanPath = String(path || '').replace(/^\/+/, '')
  return `/api/${provider}/${cleanPath}`
}

export function providerWsPath(providerId, path) {
  const provider = encodeURIComponent(providerId || DEFAULT_PROVIDER_ID)
  const cleanPath = String(path || '').replace(/^\/+/, '')
  return `/ws/${provider}/${cleanPath}`
}

export function providerStorageKey(providerId, key) {
  return `agent-dash:${providerId || DEFAULT_PROVIDER_ID}:${key}`
}

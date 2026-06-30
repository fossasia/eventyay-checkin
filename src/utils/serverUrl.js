import { mande } from 'mande'
import { toValue } from 'vue'

export function unwrapValue(value) {
  return toValue(value)
}

export function normalizeServerUrl(inputUrl) {
  let cleanUrl = String(unwrapValue(inputUrl) || '').trim()
  if (!cleanUrl) {
    return ''
  }
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = 'https://' + cleanUrl
  }
  return cleanUrl.replace(/\/+$/, '')
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || '').toLowerCase())
}

/**
 * Pick an API base URL that the current browser can reach.
 * Chrome blocks cross-origin loopback calls (e.g. 127.0.0.1:8085 -> localhost:8000).
 * When both app and API are on loopback, use the page origin so /api is proxied (vite dev/preview).
 */
export function resolveServerUrl(qrUrl) {
  const normalized = normalizeServerUrl(qrUrl)
  if (!normalized || typeof window === 'undefined') {
    return normalized
  }

  const page = window.location

  try {
    const api = new URL(normalized)

    if (api.origin === page.origin) {
      return page.origin
    }

    const pageHost = page.hostname
    const pageIsLoopback = isLoopbackHost(pageHost)
    const apiIsLoopback = isLoopbackHost(api.hostname)

    // Chrome: never call :8000 directly from :8085 — use same-origin /api proxy instead.
    if (pageIsLoopback && apiIsLoopback) {
      return page.origin
    }
  } catch {
    return normalized
  }

  return normalized
}

export function deviceApi(baseUrl, options = {}) {
  return mande(resolveServerUrl(baseUrl), {
    // Do not send Django session cookies — Chrome would otherwise authenticate
    // as the control-panel user and ignore the Device token (403 on device APIs).
    credentials: 'omit',
    ...options
  })
}

function toApiResourcePath(resourceUrl) {
  const raw = String(resourceUrl || '').trim()
  if (!raw) {
    return ''
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      return `${parsed.pathname}${parsed.search}`
    } catch {
      return raw
    }
  }
  return raw.startsWith('/') ? raw : `/${raw}`
}

/** Build a path under /api/v1/ (always leading slash). */
export function apiV1Path(path) {
  const stripped = String(path || '').replace(/^\/+/, '')
  return stripped ? `/api/v1/${stripped}` : '/api/v1/'
}

export function createAuthorizedDeviceApi(baseUrl, apitoken, extraHeaders = {}) {
  const resolvedBaseUrl = unwrapValue(baseUrl)
  const resolvedToken = unwrapValue(apitoken)
  if (!resolvedBaseUrl || !resolvedToken) {
    throw new Error('Device API credentials are not configured')
  }
  return deviceApi(resolvedBaseUrl, {
    headers: {
      Authorization: `Device ${resolvedToken}`,
      ...extraHeaders
    }
  })
}

/** Lead scanner exhibitor API paths (exhibition plugin). */
export function exhibitorApiPath(organizer, eventSlug, subpath) {
  const org = unwrapValue(organizer)
  const event = unwrapValue(eventSlug)
  const suffix = String(subpath || '').replace(/^\/+/, '')
  return `/api/v1/event/${org}/${event}/exhibitors/${suffix}`
}

export function createAuthorizedExhibitorApi(baseUrl, apitoken, exhibitorKey, extraHeaders = {}) {
  const resolvedKey = unwrapValue(exhibitorKey)
  if (!resolvedKey) {
    throw new Error('Exhibitor key is not configured')
  }
  return createAuthorizedDeviceApi(baseUrl, apitoken, {
    Accept: 'application/json',
    Exhibitor: resolvedKey,
    ...extraHeaders
  })
}

/**
 * Resolve API resource paths against the reachable server base.
 * Strips absolute hosts from API responses so fetches stay same-origin (e.g. Vite proxy in dev).
 */
export function resolveApiResourceUrl(resourceUrl, baseUrl) {
  const base = resolveServerUrl(baseUrl)
  const path = toApiResourcePath(resourceUrl)
  if (!path || !base) {
    return ''
  }
  return `${base.replace(/\/+$/, '')}${path}`
}

/** Store only the path so persisted sessions do not keep unreachable absolute API hosts. */
export function normalizeApiResourcePath(resourceUrl) {
  return toApiResourcePath(resourceUrl)
}

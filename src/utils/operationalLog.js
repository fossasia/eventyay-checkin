const SAFE = /^[A-Za-z0-9._:-]{1,128}$/
const JWT_LIKE = /^eyJ[A-Za-z0-9_-]+\./
const SECRET_PREFIX = /^(sk|pk|whsec|rk|bearer|token)[_-]/i
const SAFE_OUTCOMES = new Set(['success', 'failure', 'cancelled'])

/**
 * Generate an opaque operational request/correlation identifier safe for logs.
 *
 * @param {string} [prefix='op']
 * @returns {string}
 */
export function createOperationalId(prefix = 'op') {
  const safePrefix = safeValue(prefix) || 'op'
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${safePrefix}_${crypto.randomUUID().slice(0, 12)}`
    }
  } catch {
    // Fall back to Math.random when crypto.randomUUID is unavailable.
  }
  return `${safePrefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Known safe operational error codes for check-in redeem responses.
 * Raw server reason text is mapped through this allowlist so arbitrary
 * server messages or sensitive data cannot leak into operational logs.
 */
export const SAFE_REDEEM_ERROR_CODES = new Set([
  'invalid',
  'invalid_time',
  'already_redeemed',
  'checkout_required',
  'ambiguous',
  'revoked',
  'product',
  'subevent',
  'unpaid',
  'rules',
  'canceled',
  'max_questions',
  'questions',
  'missing'
])

function isSecretLike(value, { allowOpaqueId = false } = {}) {
  if (JWT_LIKE.test(value) || SECRET_PREFIX.test(value)) return true
  if (!allowOpaqueId && value.length > 40 && !value.includes('.')) return true
  return false
}

function safeValue(value, options) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && SAFE.test(value) && !isSecretLike(value, options)) return value
  return null
}

/**
 * Map a candidate error code through an explicit allowlist of safe tokens.
 *
 * @param {unknown} value
 * @param {Set<string>} allowedCodes
 * @param {string} [fallback='request_error']
 * @returns {string}
 */
export function toSafeErrorCode(value, allowedCodes, fallback = 'request_error') {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (allowedCodes && allowedCodes.has(trimmed) && SAFE.test(trimmed)) {
      return trimmed
    }
  }
  return safeValue(fallback) || 'request_error'
}

/**
 * Emit a privacy-safe single-line operational log entry.
 * Drops any unexpected or unsafe fields (emails, tokens, URLs, bodies) and
 * swallows internal errors so logging never disrupts app execution.
 *
 * @param {object} [params]
 * @param {string} [params.action]
 * @param {'success'|'failure'|'cancelled'} [params.outcome]
 * @param {string|null} [params.error_code]
 * @param {string} [params.backend='checkin']
 * @param {number|null} [params.status]
 * @param {number} [params.duration_ms]
 * @param {string|null} [params.request_id]
 * @param {string|null} [params.correlation_id]
 * @param {string|null} [params.resource_type]
 * @param {string|null} [params.object_id]
 */
export function logOperational({
  action,
  outcome,
  error_code,
  backend = 'checkin',
  status,
  duration_ms,
  request_id,
  correlation_id,
  resource_type,
  object_id
} = {}) {
  try {
    if (typeof action !== 'string' || !SAFE.test(action) || isSecretLike(action)) return
    const safeOutcome = SAFE_OUTCOMES.has(outcome) ? outcome : 'failure'
    const record = {
      datetime: new Date().toISOString(),
      component: 'plugins',
      action,
      outcome: safeOutcome,
      backend: safeValue(backend) || 'checkin'
    }
    const errorCode = safeValue(error_code)
    const statusCode = safeValue(status)
    const duration = safeValue(duration_ms)
    const requestId = safeValue(request_id, { allowOpaqueId: true })
    const correlationId = safeValue(correlation_id, { allowOpaqueId: true })
    const resourceType = safeValue(resource_type)
    const objectId = safeValue(object_id)
    if (errorCode != null) record.error_code = errorCode
    if (statusCode != null) record.status = statusCode
    if (duration != null) record.duration_ms = duration
    if (requestId != null) record.request_id = requestId
    if (correlationId != null) record.correlation_id = correlationId
    if (resourceType != null) record.resource_type = resourceType
    if (objectId != null) record.object_id = objectId
    const line = Object.entries(record)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')
    if (safeOutcome === 'failure') console.warn('[eventyay]', line)
    else console.info('[eventyay]', line)
  } catch {
    // Logging must never break check-in, scanning, or printing.
  }
}

/**
 * Log the outcome of an outbound API request without URLs, headers, or bodies.
 *
 * @param {object} [params]
 */
export function logApiResult({
  outcome,
  status,
  duration_ms,
  error_code,
  request_id,
  correlation_id,
  resource_type,
  object_id,
  action = 'connection.request'
} = {}) {
  logOperational({
    action,
    outcome,
    status,
    duration_ms,
    error_code,
    request_id,
    correlation_id,
    resource_type,
    object_id,
    backend: 'checkin'
  })
}

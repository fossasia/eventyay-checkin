const SAFE = /^[A-Za-z0-9._:-]{1,128}$/

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

function safeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && SAFE.test(value)) return value
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
 * @param {'success'|'failure'} [params.outcome]
 * @param {string|null} [params.error_code]
 * @param {string} [params.backend='checkin']
 * @param {number|null} [params.status]
 * @param {number} [params.duration_ms]
 * @param {string|null} [params.request_id]
 * @param {string|null} [params.correlation_id]
 */
export function logOperational({
  action,
  outcome,
  error_code,
  backend = 'checkin',
  status,
  duration_ms,
  request_id,
  correlation_id
} = {}) {
  try {
    if (typeof action !== 'string' || !SAFE.test(action)) return
    const safeOutcome = outcome === 'success' ? 'success' : 'failure'
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
    const requestId = safeValue(request_id)
    const correlationId = safeValue(correlation_id)
    if (errorCode != null) record.error_code = errorCode
    if (statusCode != null) record.status = statusCode
    if (duration != null) record.duration_ms = duration
    if (requestId != null) record.request_id = requestId
    if (correlationId != null) record.correlation_id = correlationId
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
    backend: 'checkin'
  })
}

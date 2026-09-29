const SAFE = /^[A-Za-z0-9._:-]{1,128}$/

function safeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && SAFE.test(value)) return value
  return null
}

export function logOperational({
  action,
  outcome,
  error_code,
  backend = 'checkin',
  status,
  duration_ms
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
    if (errorCode != null) record.error_code = errorCode
    if (statusCode != null) record.status = statusCode
    if (duration != null) record.duration_ms = duration
    const line = Object.entries(record)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')
    if (safeOutcome === 'failure') console.warn('[eventyay]', line)
    else console.info('[eventyay]', line)
  } catch {
    // Logging must never break check-in, scanning, or printing.
  }
}

export function logApiResult({
  outcome,
  status,
  duration_ms,
  error_code,
  action = 'connection.request'
} = {}) {
  logOperational({
    action,
    outcome,
    status,
    duration_ms,
    error_code,
    backend: 'checkin'
  })
}

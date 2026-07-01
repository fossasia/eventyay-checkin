export const DEVICE_PROFILE_DENIED_MESSAGE =
  'The security profile selected for this device does not allow this functionality. Please contact your organizer to change your profile if you feel this is a mistake.'

export const DEVICE_PROFILE_DENIED_SERVER_DETAIL = 'Request denied by device security profile.'

export class DeviceProfileDeniedError extends Error {
  constructor(message = DEVICE_PROFILE_DENIED_MESSAGE) {
    super(message)
    this.name = 'DeviceProfileDeniedError'
  }
}

export function getDeviceErrorStatus(error) {
  return error?.response?.status ?? error?.status ?? 0
}

export function getDeviceErrorDetail(error) {
  if (error instanceof DeviceProfileDeniedError) {
    return DEVICE_PROFILE_DENIED_MESSAGE
  }

  const body = error?.body ?? error?.response?.data ?? error?.cause?.body
  if (typeof body === 'string' && body) {
    return body
  }
  if (body && typeof body === 'object') {
    return String(body.detail || body.message || body.error || '')
  }
  return ''
}

function getDeviceErrorUrl(error) {
  return String(error?.response?.url || error?.url || '')
}

export function isExhibitorApiError(error) {
  const url = getDeviceErrorUrl(error)
  if (url.includes('/exhibitors/')) {
    return true
  }

  const body = error?.body ?? error?.response?.data
  return Boolean(body && typeof body === 'object' && 'success' in body)
}

export function isDeviceProfileDeniedResponse(status, detail) {
  return status === 403 && String(detail || '').includes('device security profile')
}

export function isDeviceAuthFailure(error) {
  if (isExhibitorApiError(error)) {
    return false
  }

  const status = getDeviceErrorStatus(error)
  if (status === 401) {
    const detail = getDeviceErrorDetail(error).toLowerCase()
    return (
      detail.includes('invalid token') ||
      detail.includes('credentials were not provided') ||
      detail.includes('device access has been revoked') ||
      detail.includes('device has not been initialized') ||
      detail.includes('authentication credentials') ||
      !detail
    )
  }
  if (status === 403) {
    const detail = getDeviceErrorDetail(error).toLowerCase()
    return (
      detail.includes('invalid token') ||
      detail.includes('credentials were not provided') ||
      detail.includes('device access has been revoked') ||
      detail.includes('authentication credentials')
    )
  }
  return false
}

export function isDeviceProfileDenied(error) {
  if (error instanceof DeviceProfileDeniedError) {
    return true
  }
  return isDeviceProfileDeniedResponse(getDeviceErrorStatus(error), getDeviceErrorDetail(error))
}

export function getExhibitorErrorMessage(error, fallback = 'Lead scan request failed.') {
  const status = getDeviceErrorStatus(error)
  if (status === 401) {
    const detail = getDeviceErrorDetail(error).toLowerCase()
    if (
      detail.includes('invalid token') ||
      detail.includes('device access has been revoked') ||
      detail.includes('device has not been initialized')
    ) {
      return 'Device authentication failed. Register this device again from the organizer dashboard.'
    }
    return 'Exhibitor authentication failed. Open exhibitor sign-in and enter your exhibitor key again.'
  }
  if (status === 403 && isDeviceProfileDenied(error)) {
    return DEVICE_PROFILE_DENIED_MESSAGE
  }
  return getDeviceErrorMessage(error, fallback, { hideHttpStatusText: true })
}

/**
 * Handle exhibitor API failures without signing the device out.
 * Returns true when the error was handled.
 */
export function handleExhibitorApiError(error, processApi, { onError, onProfileDenied } = {}) {
  if (isExhibitorApiError(error) && getDeviceErrorStatus(error) === 401) {
    onError?.(getExhibitorErrorMessage(error))
    return true
  }
  if (isDeviceAuthFailure(error)) {
    processApi?.handleAuthError?.()
    return true
  }
  if (isDeviceProfileDenied(error)) {
    onProfileDenied?.(DEVICE_PROFILE_DENIED_MESSAGE)
    return true
  }
  onError?.(getExhibitorErrorMessage(error))
  return true
}

/**
 * Handle 401 (logout) and 403 (profile denied). Returns true when the error was handled.
 */
export function handleDeviceApiError(error, processApi, { onProfileDenied } = {}) {
  if (isDeviceAuthFailure(error)) {
    processApi?.handleAuthError?.()
    return true
  }
  if (isDeviceProfileDenied(error)) {
    onProfileDenied?.(DEVICE_PROFILE_DENIED_MESSAGE)
    return true
  }
  return false
}

/** Re-throw profile denial; logout on 401. Use in store catch blocks. */
export function raiseIfDeviceApiError(error, processApi) {
  if (isDeviceAuthFailure(error)) {
    processApi?.handleAuthError?.()
    throw error
  }
  if (isDeviceProfileDenied(error)) {
    throw new DeviceProfileDeniedError()
  }
}

export function getDeviceErrorMessage(error, fallback = '', options = {}) {
  const hideHttpStatusText = Boolean(options.hideHttpStatusText)
  if (isDeviceProfileDenied(error) || error instanceof DeviceProfileDeniedError) {
    return DEVICE_PROFILE_DENIED_MESSAGE
  }
  const body = error?.body ?? error?.response?.data ?? error?.cause?.body
  if (body && typeof body === 'object' && body.error) {
    return String(body.error)
  }
  if (body && typeof body === 'object' && !body.detail && !body.message) {
    const parts = []
    for (const [field, value] of Object.entries(body)) {
      if (Array.isArray(value)) {
        parts.push(`${field}: ${value.join(', ')}`)
      } else if (value && typeof value === 'object') {
        parts.push(`${field}: ${JSON.stringify(value)}`)
      } else if (value) {
        parts.push(`${field}: ${value}`)
      }
    }
    if (parts.length) {
      return parts.join('; ')
    }
  }
  const detail = getDeviceErrorDetail(error)
  if (detail) {
    return detail
  }
  const message = error?.message || fallback
  if (
    hideHttpStatusText &&
    /^(internal server error|bad request|not found|forbidden|unauthorized)$/i.test(String(message).trim())
  ) {
    return fallback
  }
  return message || fallback
}

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

  const body = error?.body ?? error?.response?.data
  if (typeof body === 'string' && body) {
    return body
  }
  if (body && typeof body === 'object') {
    return String(body.detail || body.message || '')
  }
  return ''
}

export function isDeviceProfileDeniedResponse(status, detail) {
  return status === 403 && String(detail || '').includes('device security profile')
}

export function isDeviceAuthFailure(error) {
  const status = getDeviceErrorStatus(error)
  if (status === 401) {
    return true
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

export function getDeviceErrorMessage(error, fallback = '') {
  if (isDeviceProfileDenied(error) || error instanceof DeviceProfileDeniedError) {
    return DEVICE_PROFILE_DENIED_MESSAGE
  }
  const detail = getDeviceErrorDetail(error)
  if (detail) {
    return detail
  }
  return error?.message || fallback
}

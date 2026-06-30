import {
  DEVICE_PROFILE_DENIED_MESSAGE,
  DeviceProfileDeniedError,
  getDeviceErrorMessage,
  handleDeviceApiError,
  isDeviceAuthFailure,
  isDeviceProfileDenied
} from '@/utils/deviceErrors'
import { describe, expect, it, vi } from 'vitest'

describe('isDeviceAuthFailure', () => {
  it('treats 401 as an auth failure', () => {
    expect(isDeviceAuthFailure({ status: 401 })).toBe(true)
  })

  it('treats revoked or invalid token 403 responses as auth failures', () => {
    expect(
      isDeviceAuthFailure({
        status: 403,
        body: { detail: 'Invalid token.' }
      })
    ).toBe(true)
    expect(
      isDeviceAuthFailure({
        status: 403,
        body: { detail: 'Device access has been revoked.' }
      })
    ).toBe(true)
  })

  it('does not treat profile denial as auth failure', () => {
    expect(
      isDeviceAuthFailure({
        status: 403,
        body: { detail: 'Request denied by device security profile.' }
      })
    ).toBe(false)
  })
})

describe('isDeviceProfileDenied', () => {
  it('detects profile denial from API responses and custom errors', () => {
    expect(
      isDeviceProfileDenied({
        status: 403,
        body: { detail: 'Request denied by device security profile.' }
      })
    ).toBe(true)
    expect(isDeviceProfileDenied(new DeviceProfileDeniedError())).toBe(true)
  })
})

describe('handleDeviceApiError', () => {
  it('logs out on auth failures', () => {
    const processApi = { handleAuthError: vi.fn() }
    const handled = handleDeviceApiError({ status: 401 }, processApi)
    expect(handled).toBe(true)
    expect(processApi.handleAuthError).toHaveBeenCalledOnce()
  })

  it('invokes profile-denied callback without logging out', () => {
    const processApi = { handleAuthError: vi.fn() }
    const onProfileDenied = vi.fn()
    const error = {
      status: 403,
      body: { detail: 'Request denied by device security profile.' }
    }
    const handled = handleDeviceApiError(error, processApi, { onProfileDenied })
    expect(handled).toBe(true)
    expect(processApi.handleAuthError).not.toHaveBeenCalled()
    expect(onProfileDenied).toHaveBeenCalledWith(DEVICE_PROFILE_DENIED_MESSAGE)
  })
})

describe('getDeviceErrorMessage', () => {
  it('returns profile denial guidance for blocked actions', () => {
    expect(
      getDeviceErrorMessage({
        status: 403,
        body: { detail: 'Request denied by device security profile.' }
      })
    ).toBe(DEVICE_PROFILE_DENIED_MESSAGE)
  })

  it('falls back to API detail and then generic message', () => {
    expect(getDeviceErrorMessage({ body: { detail: 'List not found' } })).toBe('List not found')
    expect(getDeviceErrorMessage(new Error('network down'), 'Try again')).toBe('network down')
  })
})

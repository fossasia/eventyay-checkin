import {
  getAutoPrintPreference,
  getRoleRouteName,
  getServerDisplayFromUrl,
  parseQrPayload,
  setAutoPrintPreference
} from '@/utils/session'
import { afterEach, describe, expect, it } from 'vitest'

describe('parseQrPayload', () => {
  it('returns trimmed plain text when not JSON', () => {
    expect(parseQrPayload('  abc123  ', 'token')).toBe('abc123')
  })

  it('extracts a field from JSON device setup payloads', () => {
    const payload = JSON.stringify({ url: 'https://eventyay.com', token: 'dev-token' })
    expect(parseQrPayload(payload, 'token')).toBe('dev-token')
    expect(parseQrPayload(payload, 'url')).toBe('https://eventyay.com')
  })

  it('falls back to raw value when JSON lacks the requested field', () => {
    expect(parseQrPayload('{"url":"https://x.test"}', 'token')).toBe('{"url":"https://x.test"}')
  })
})

describe('getRoleRouteName', () => {
  it('maps known device roles to app routes', () => {
    expect(getRoleRouteName('CheckIn')).toBe('eventyaycheckin')
    expect(getRoleRouteName('Badge Station')).toBe('eventyaycheckin')
    expect(getRoleRouteName('Exhibitor')).toBe('eventyayleedlogin')
  })

  it('returns null for unknown roles', () => {
    expect(getRoleRouteName('Unknown')).toBeNull()
  })
})

describe('auto-print preferences', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('defaults Badge Station to enabled and CheckIn to disabled', () => {
    expect(getAutoPrintPreference('Badge Station')).toBe(true)
    expect(getAutoPrintPreference('CheckIn')).toBe(false)
  })

  it('persists per-role preferences', () => {
    setAutoPrintPreference('CheckIn', true)
    expect(getAutoPrintPreference('CheckIn')).toBe(true)
    expect(getAutoPrintPreference('Badge Station')).toBe(true)
  })
})

describe('getServerDisplayFromUrl', () => {
  it('shows host for valid URLs', () => {
    expect(getServerDisplayFromUrl('https://tickets.example.org/path')).toBe('tickets.example.org')
  })

  it('strips scheme for invalid URLs', () => {
    expect(getServerDisplayFromUrl('eventyay.test/')).toBe('eventyay.test')
  })
})

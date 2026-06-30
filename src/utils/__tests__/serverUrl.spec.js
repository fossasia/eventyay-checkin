import {
  apiV1Path,
  createAuthorizedDeviceApi,
  normalizeApiResourcePath,
  normalizeServerUrl,
  resolveApiResourceUrl,
  resolveServerUrl
} from '@/utils/serverUrl'
import { afterEach, describe, expect, it } from 'vitest'

describe('normalizeServerUrl', () => {
  it('adds https and strips trailing slashes', () => {
    expect(normalizeServerUrl('eventyay.test/')).toBe('https://eventyay.test')
    expect(normalizeServerUrl('https://eventyay.test/api/')).toBe('https://eventyay.test/api')
  })

  it('returns empty string for blank input', () => {
    expect(normalizeServerUrl('   ')).toBe('')
  })
})

describe('resolveServerUrl', () => {
  const originalLocation = window.location

  afterEach(() => {
    window.location = originalLocation
  })

  it('uses page origin when API and app share loopback hosts', () => {
    window.location = new URL('http://127.0.0.1:8085')
    expect(resolveServerUrl('http://localhost:8000')).toBe('http://127.0.0.1:8085')
  })

  it('keeps remote API hosts unchanged', () => {
    window.location = new URL('https://checkin.example.org')
    expect(resolveServerUrl('https://tickets.example.org')).toBe('https://tickets.example.org')
  })
})

describe('apiV1Path', () => {
  it('builds device API paths with a single leading slash', () => {
    expect(apiV1Path('device/session')).toBe('/api/v1/device/session')
    expect(apiV1Path('/device/session')).toBe('/api/v1/device/session')
    expect(apiV1Path('')).toBe('/api/v1/')
  })
})

describe('resolveApiResourceUrl', () => {
  it('resolves absolute badge URLs against the reachable base', () => {
    window.location = new URL('http://127.0.0.1:8085')
    const resource = 'https://localhost:8000/api/v1/badge.pdf'
    expect(resolveApiResourceUrl(resource, 'http://localhost:8000')).toBe(
      'http://127.0.0.1:8085/api/v1/badge.pdf'
    )
  })
})

describe('normalizeApiResourcePath', () => {
  it('stores only the path portion of API resources', () => {
    expect(normalizeApiResourcePath('https://host.test/api/v1/foo?x=1')).toBe('/api/v1/foo?x=1')
    expect(normalizeApiResourcePath('positions/1/badge/')).toBe('/positions/1/badge/')
  })
})

describe('createAuthorizedDeviceApi', () => {
  it('requires credentials before creating a client', () => {
    expect(() => createAuthorizedDeviceApi('', 'token')).toThrow(
      'Device API credentials are not configured'
    )
    expect(() => createAuthorizedDeviceApi('https://eventyay.test', '')).toThrow(
      'Device API credentials are not configured'
    )
  })
})

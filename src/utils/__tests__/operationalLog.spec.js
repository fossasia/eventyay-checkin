import { createMemoryIndex } from '@/offline/memoryIndex'
import { createEmptySnapshot } from '@/offline/normalize'
import { flushPendingRedeems } from '@/offline/offlineActions'
import { runOfflineSync } from '@/offline/syncEngine'
import { useApiStore } from '@/stores/api'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useleedauth } from '@/stores/leedauth'
import { DEVICE_PROFILE_DENIED_SERVER_DETAIL } from '@/utils/deviceErrors'
import {
  logApiResult,
  logOperational,
  SAFE_REDEEM_ERROR_CODES,
  toSafeErrorCode
} from '@/utils/operationalLog'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('operationalLog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('writes a status line and drops emails, tokens, and urls', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logOperational({
      action: 'connection.request',
      outcome: 'success',
      status: 200,
      duration_ms: 12,
      backend: 'checkin',
      request_id: 'req-123',
      correlation_id: 'corr_456',
      email: 'person@example.com',
      token: 'secret',
      url: 'https://example.invalid/token'
    })
    expect(info).toHaveBeenCalledTimes(1)
    const line = info.mock.calls[0][1]
    expect(line).toContain('outcome=success')
    expect(line).toContain('status=200')
    expect(line).toContain('request_id=req-123')
    expect(line).toContain('correlation_id=corr_456')
    expect(line).not.toContain('person@example.com')
    expect(line).not.toContain('secret')
    expect(line).not.toContain('example.invalid')
  })

  it('drops unsafe request_id and correlation_id values', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logOperational({
      action: 'connection.request',
      outcome: 'success',
      request_id: 'https://example.invalid/leak?token=abc',
      correlation_id: 'has spaces'
    })
    const line = info.mock.calls[0][1]
    expect(line).not.toContain('request_id=')
    expect(line).not.toContain('correlation_id=')
  })

  it('ignores unsafe action names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logOperational({ action: 'bad action', outcome: 'failure', error_code: 'nope value' })
    expect(warn).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('logs API failures with a safe error code', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logApiResult({ outcome: 'failure', status: 401, error_code: 'http_error', duration_ms: 8 })
    expect(warn.mock.calls[0][1]).toContain('error_code=http_error')
    expect(warn.mock.calls[0][1]).toContain('status=401')
  })

  it('maps redeem reasons through an allowlist with a fixed fallback', () => {
    expect(toSafeErrorCode('already_redeemed', SAFE_REDEEM_ERROR_CODES, 'redeem_failed')).toBe(
      'already_redeemed'
    )
    expect(
      toSafeErrorCode('secret-token-leak-from-server', SAFE_REDEEM_ERROR_CODES, 'redeem_failed')
    ).toBe('redeem_failed')
  })

  it('logs both success and failure outcomes in api store', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const api = useApiStore()
    await api.get(false, 'events/1')
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][1]).toContain('outcome=success')

    await expect(api.post(false, 'events/1', { a: 1 })).rejects.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('outcome=failure')
    expect(warn.mock.calls[0][1]).toContain('error_code=http_error')
  })

  it('logs already_redeemed as success, sanitizes unknown reasons, and logs network/json failures in flushPendingRedeems', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const index = createMemoryIndex(createEmptySnapshot('org', 'evt'))
    index.pendingRedeems = [
      { secret: 's1', lists: [1], nonce: 'n1' },
      { secret: 's2', lists: [1], nonce: 'n2' },
      { secret: 's3', lists: [1], nonce: 'n3' },
      { secret: 's4', lists: [1], nonce: 'n4' }
    ]

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'error', reason: 'already_redeemed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: 'error', reason: 'sensitive_internal_server_reason' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response('null', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockRejectedValueOnce(new TypeError('NetworkError'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await flushPendingRedeems(index, {
      url: 'https://example.invalid',
      apitoken: 'tok',
      organizer: 'org'
    })

    expect(result.flushed).toBe(1)
    expect(result.remaining).toHaveLength(3)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][1]).toContain('action=checkin.redeem')
    expect(info.mock.calls[0][1]).toContain('outcome=success')

    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls[0][1]).toContain('error_code=redeem_failed')
    expect(warn.mock.calls[0][1]).not.toContain('sensitive_internal_server_reason')
    expect(warn.mock.calls[1][1]).toContain('error_code=invalid_payload')
    expect(warn.mock.calls[2][1]).toContain('error_code=request_error')
    expect(warn.mock.calls[2][1]).not.toContain('status=')
  })

  it('logs invalid_payload instead of success when syncEngine receives JSON null', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('null', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runOfflineSync({
      url: 'https://example.invalid',
      apitoken: 'tok',
      organizer: 'org',
      eventSlug: 'evt',
      selectedRole: 'CheckIn',
      securityProfile: 'eventyay_checkin'
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('orders_sync_failed')
    expect(info).not.toHaveBeenCalled()
    expect(warn.mock.calls.some((call) => call[1].includes('error_code=invalid_payload'))).toBe(
      true
    )
  })

  it('logs device_profile_denied instead of invalid_credentials on exhibitor 403 profile denial', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: DEVICE_PROFILE_DENIED_SERVER_DETAIL }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const processApi = useEventyayApi()
    processApi.setApiCred('tok', 'https://example.invalid', 'org')
    processApi.setEvent('evt', 'Event')

    const leedauth = useleedauth()
    const res = await leedauth.leedlogin({ key: 'ex-key' })

    expect(res.success).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('action=auth.exhibitor')
    expect(warn.mock.calls[0][1]).toContain('error_code=device_profile_denied')
    expect(warn.mock.calls[0][1]).not.toContain('invalid_credentials')
  })
})

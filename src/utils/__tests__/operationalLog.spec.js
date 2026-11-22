import { createMemoryIndex } from '@/offline/memoryIndex'
import { createEmptySnapshot } from '@/offline/normalize'
import { flushPendingRedeems } from '@/offline/offlineActions'
import * as snapshotStore from '@/offline/snapshotStore'
import { runOfflineSync } from '@/offline/syncEngine'
import { useApiStore } from '@/stores/api'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useleedauth } from '@/stores/leedauth'
import { useLiveRegistrationStore } from '@/stores/liveRegistration'
import { useOfflineSyncStore } from '@/stores/offlineSync'
import { usePrintModalStore } from '@/stores/printModal'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import * as badgePdf from '@/utils/badgePdf'
import { DEVICE_PROFILE_DENIED_SERVER_DETAIL } from '@/utils/deviceErrors'
import {
  createOperationalId,
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ready' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const api = useApiStore()
    const res200 = await api.get(false, 'events/1')
    expect(res200).toEqual({ ok: true })
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][1]).toContain('outcome=success')
    expect(info.mock.calls[0][1]).toContain('status=200')
    expect(info.mock.calls[0][1]).toContain('request_id=req_')

    const resReady = await api.get(false, 'events/1/status')
    expect(resReady).toEqual({ status: 'ready' })
    expect(info).toHaveBeenCalledTimes(2)
    expect(info.mock.calls[1][1]).toContain('status=200')
    expect(info.mock.calls[1][1]).not.toContain('status=ready')

    const res201 = await api.post(false, 'events/1', { a: 1 })
    expect(res201).toEqual({ id: 42 })
    expect(info).toHaveBeenCalledTimes(3)
    expect(info.mock.calls[2][1]).toContain('status=201')

    const res204 = await api.post(false, 'events/1/ack')
    expect(res204).toBeNull()
    expect(info).toHaveBeenCalledTimes(4)
    expect(info.mock.calls[3][1]).toContain('status=204')

    await expect(api.post(false, 'events/1', { a: 1 })).rejects.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('outcome=failure')
    expect(warn.mock.calls[0][1]).toContain('error_code=http_error')
    expect(warn.mock.calls[0][1]).toContain('request_id=req_')
  })

  it('rejects JWTs, secret-prefixed keys, and long high-entropy token strings in safeValue', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logOperational({
      action: 'connection.request',
      outcome: 'success',
      error_code: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      resource_type: 'sk_live_1234567890abcdef',
      object_id: 'a'.repeat(45),
      request_id: 'token_secret_123'
    })
    expect(info).toHaveBeenCalledTimes(1)
    const line = info.mock.calls[0][1]
    expect(line).not.toContain('error_code=')
    expect(line).not.toContain('resource_type=')
    expect(line).not.toContain('object_id=')
    expect(line).not.toContain('request_id=')
  })

  it('supports cancelled outcome without error_code and resource context fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const id = createOperationalId('test')
    expect(id).toMatch(/^test_[A-Za-z0-9._:-]+$/)

    logOperational({
      action: 'badge.print',
      outcome: 'cancelled',
      resource_type: 'badge',
      object_id: 'badge_layout'
    })
    expect(warn).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][1]).toContain('outcome=cancelled')
    expect(info.mock.calls[0][1]).toContain('resource_type=badge')
    expect(info.mock.calls[0][1]).toContain('object_id=badge_layout')
    expect(info.mock.calls[0][1]).not.toContain('error_code=')
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
    expect(info.mock.calls.some((call) => call[1].includes('action=checkin.sync_start'))).toBe(true)
    expect(info.mock.calls.some((call) => call[1].includes('action=checkin.fetch'))).toBe(false)
    expect(warn.mock.calls.some((call) => call[1].includes('error_code=invalid_payload'))).toBe(
      true
    )
  })

  it('logs failure and retains item when flushPendingRedeems receives a malformed position', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const index = createMemoryIndex(createEmptySnapshot('org', 'evt'))
    index.pendingRedeems = [{ secret: 'sec-bad', lists: [1], nonce: 'n-bad' }]

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'ok',
          position: { secret: 'sec-bad', downloads: {} }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await flushPendingRedeems(index, {
      url: 'https://example.invalid',
      apitoken: 'tok',
      organizer: 'org'
    })

    expect(result.flushed).toBe(0)
    expect(result.remaining).toHaveLength(1)
    expect(info).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('action=checkin.redeem')
    expect(warn.mock.calls[0][1]).toContain('outcome=failure')
  })

  it('logs checkin.sync failure with correlation_id when storage load rejects', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(snapshotStore, 'loadEncryptedSnapshot').mockRejectedValueOnce(new Error('idb_down'))

    await expect(
      runOfflineSync({
        url: 'https://example.invalid',
        apitoken: 'tok',
        organizer: 'org',
        eventSlug: 'evt',
        selectedRole: 'CheckIn',
        securityProfile: 'eventyay_checkin'
      })
    ).rejects.toThrow('idb_down')

    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][1]).toContain('action=checkin.sync_start')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('action=checkin.sync')
    expect(warn.mock.calls[0][1]).toContain('outcome=failure')
    expect(warn.mock.calls[0][1]).toContain('error_code=sync_failed')
  })

  it('keeps offline action name when offline live registration persistence fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('navigator', { onLine: false })
    vi.spyOn(snapshotStore, 'saveEncryptedSnapshot').mockRejectedValueOnce(new Error('disk_full'))

    const processApi = useEventyayApi()
    processApi.setApiCred('tok', 'https://example.invalid', 'org')
    processApi.setEvent('evt', 'Event')
    processApi.setRole('CheckIn')
    processApi.setSecurityProfile('eventyay_checkin')

    const offlineSync = useOfflineSyncStore()
    offlineSync.index = createMemoryIndex(createEmptySnapshot('org', 'evt'))

    const liveReg = useLiveRegistrationStore()
    liveReg.products = [{ id: 1, name: 'General', has_variations: false }]

    await expect(
      liveReg.registerAndMarkPaid({ attendee_name: 'Ada', attendee_email: 'ada@example.test' }, 1)
    ).rejects.toThrow('disk_full')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('action=checkin.live_register_offline')
    expect(warn.mock.calls[0][1]).toContain('error_code=offline_persist_failed')
  })

  it('logs registration_failed when offline live registration fails before persistence starts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('navigator', { onLine: false })

    const processApi = useEventyayApi()
    processApi.setApiCred('tok', 'https://example.invalid', 'org')
    processApi.setEvent('evt', 'Event')
    processApi.setRole('CheckIn')
    processApi.setSecurityProfile('eventyay_checkin')

    const offlineSync = useOfflineSyncStore()
    offlineSync.index = createMemoryIndex(createEmptySnapshot('org', 'evt'))

    const liveReg = useLiveRegistrationStore()
    liveReg.products = [{ id: 1, name: 'General', has_variations: true, variations: [] }]

    await expect(
      liveReg.registerAndMarkPaid({ attendee_name: 'Ada', attendee_email: 'ada@example.test' }, 1)
    ).rejects.toThrow('Selected product requires a variation')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('action=checkin.live_register_offline')
    expect(warn.mock.calls[0][1]).toContain('error_code=registration_failed')
  })

  it('logs cancelled badge prints with outcome=cancelled and without error_code', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const processApi = useEventyayApi()
    processApi.setApiCred('tok', 'https://example.invalid', 'org')
    processApi.setEvent('evt', 'Event')

    vi.spyOn(badgePdf, 'fetchBadgePdfWithRetry').mockResolvedValueOnce({
      status: 'ready',
      blob: new Blob(['pdf'], { type: 'application/pdf' })
    })
    vi.spyOn(badgePdf, 'printPdfBlob').mockResolvedValueOnce(badgePdf.PRINT_OUTCOME.CANCELLED)

    const checkInStore = useProcessEventyayCheckInStore()
    const outcome = await checkInStore.printBadge('/api/v1/badge/1')

    expect(outcome).toBe(badgePdf.PRINT_OUTCOME.CANCELLED)
    expect(warn).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][1]).toContain('action=badge.print')
    expect(info.mock.calls[0][1]).toContain('outcome=cancelled')
    expect(info.mock.calls[0][1]).not.toContain('error_code=')
  })

  it('logs offline_persist_failed rather than invalid_qr when offline checkIn persistence fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('navigator', { onLine: false })
    vi.spyOn(snapshotStore, 'saveEncryptedSnapshot').mockRejectedValueOnce(new Error('quota'))

    const processApi = useEventyayApi()
    processApi.setApiCred('tok', 'https://example.invalid', 'org')
    processApi.setEvent('evt', 'Event')
    processApi.setRole('CheckIn')
    processApi.setSecurityProfile('eventyay_checkin')
    processApi.setSelectedCheckInListId(3)

    const snapshot = createEmptySnapshot('org', 'evt')
    snapshot.positionsBySecret['sec-1'] = {
      id: 1,
      secret: 'sec-1',
      product: 9,
      orderStatus: 'p',
      attendeeName: 'Ada',
      attendeeEmail: 'ada@example.test',
      checkins: [],
      listIds: [3],
      pdfData: { attendee_name: 'Ada' },
      searchText: 'ada'
    }
    const offlineSync = useOfflineSyncStore()
    offlineSync.index = createMemoryIndex(snapshot)

    const checkInStore = useProcessEventyayCheckInStore()
    checkInStore.availableCheckInLists = [{ id: 3, name: 'Main' }]

    const { useCameraStore } = await import('@/stores/camera')
    const cameraStore = useCameraStore()
    cameraStore.qrCodeValue = 'sec-1'

    const res = await checkInStore.checkIn()
    expect(res).toBeNull()
    expect(info).not.toHaveBeenCalled()
    expect(
      warn.mock.calls.some((call) => call[1].includes('error_code=offline_persist_failed'))
    ).toBe(true)
    expect(warn.mock.calls.some((call) => call[1].includes('error_code=invalid_qr'))).toBe(false)
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

  it('correlates printModal badge operations with api requests and defers pdf_fetch outcome to frame load/error', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ field_identifier: 'name', custom_field: 'Name' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task_url: 'api/tasks/1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const printFrame = {
      src: '',
      onload: null,
      onerror: null,
      contentWindow: { print: vi.fn() }
    }
    vi.spyOn(document, 'getElementById').mockReturnValue(printFrame)

    const printModal = usePrintModalStore()
    printModal.ticketId = '10'
    printModal.attendeeId = '20'

    await printModal.getBadgeFields()
    expect(info).toHaveBeenCalledTimes(2)
    const apiFieldsLog = info.mock.calls[0][1]
    const badgeFieldsLog = info.mock.calls[1][1]
    const fieldsCorr = apiFieldsLog.match(/correlation_id=([^\s]+)/)?.[1]
    expect(fieldsCorr).toBeTruthy()
    expect(badgeFieldsLog).toContain('action=badge.fields_fetch')
    expect(badgeFieldsLog).toContain(`correlation_id=${fieldsCorr}`)

    info.mockClear()
    await printModal.getPDF('name')
    expect(info).toHaveBeenCalledTimes(2)
    const apiPdfLog = info.mock.calls[0][1]
    const setupLog = info.mock.calls[1][1]
    const pdfCorr = apiPdfLog.match(/correlation_id=([^\s]+)/)?.[1]
    expect(pdfCorr).toBeTruthy()
    expect(setupLog).toContain('action=badge.pdf_setup')
    expect(setupLog).toContain('outcome=success')
    expect(setupLog).toContain(`correlation_id=${pdfCorr}`)

    // Frame load completes -> badge.pdf_fetch success
    printFrame.onload()
    expect(info).toHaveBeenCalledTimes(3)
    expect(info.mock.calls[2][1]).toContain('action=badge.pdf_fetch')
    expect(info.mock.calls[2][1]).toContain('outcome=success')
    expect(info.mock.calls[2][1]).toContain(`correlation_id=${pdfCorr}`)
    expect(printFrame.contentWindow.print).toHaveBeenCalledTimes(1)

    // Frame error -> badge.pdf_fetch failure
    printFrame.onerror()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('action=badge.pdf_fetch')
    expect(warn.mock.calls[0][1]).toContain('outcome=failure')
    expect(warn.mock.calls[0][1]).toContain('error_code=badge_pdf_load_failed')
    expect(warn.mock.calls[0][1]).toContain(`correlation_id=${pdfCorr}`)
  })
})

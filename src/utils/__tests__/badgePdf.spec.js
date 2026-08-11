import { fetchBadgePdfWithRetry, withBadgeLayoutParam } from '@/utils/badgePdf'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('withBadgeLayoutParam', () => {
  it('appends a layout query param', () => {
    expect(withBadgeLayoutParam('/positions/1/download/badge/', 42)).toBe(
      '/positions/1/download/badge/?layout=42'
    )
  })

  it('replaces an existing layout query param', () => {
    expect(withBadgeLayoutParam('/positions/1/download/badge/?layout=1&x=2', 9)).toBe(
      '/positions/1/download/badge/?layout=9&x=2'
    )
  })

  it('returns the original path when layout is empty', () => {
    expect(withBadgeLayoutParam('/positions/1/download/badge/', null)).toBe(
      '/positions/1/download/badge/'
    )
  })
})

describe('fetchBadgePdfWithRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('retries after a generating badge response', async () => {
    vi.useFakeTimers()

    // Use a Uint8Array body — jsdom's Response cannot wrap Blob (`object.stream is not a function`).
    const pdfBytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]) // %PDF

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 409,
          headers: { 'Retry-After': '2' }
        })
      )
      .mockResolvedValueOnce(
        new Response(pdfBytes, {
          status: 200,
          headers: { 'content-type': 'application/pdf' }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = fetchBadgePdfWithRetry('/badges/1.pdf', {
      baseUrl: 'http://example.test',
      apitoken: 'token'
    })

    // fetchBadgePdfWithRetry uses a fixed initial delay (400ms), not Retry-After.
    await vi.advanceTimersByTimeAsync(400)
    const result = await resultPromise

    expect(result.status).toBe('ready')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})

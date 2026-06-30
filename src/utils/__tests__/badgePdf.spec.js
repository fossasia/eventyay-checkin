import { fetchBadgePdfWithRetry } from '@/utils/badgePdf'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('fetchBadgePdfWithRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('waits for Retry-After before retrying a generating badge', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 409,
          headers: { 'Retry-After': '2' }
        })
      )
      .mockResolvedValueOnce(
        new Response(new Blob(['pdf']), {
          status: 200,
          headers: { 'content-type': 'application/pdf' }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = fetchBadgePdfWithRetry('/badges/1.pdf', {
      baseUrl: 'http://example.test',
      apitoken: 'token'
    })

    await vi.advanceTimersByTimeAsync(2000)
    const result = await resultPromise

    expect(result.status).toBe('ready')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})

import { createMemoryIndex } from '@/offline/memoryIndex'
import { createEmptySnapshot } from '@/offline/normalize'
import { enqueuePendingRegistration, flushPendingRegistrations } from '@/offline/offlineActions'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

const context = {
  url: 'https://tickets.test',
  apitoken: 'device-token',
  organizer: 'org',
  eventSlug: 'event'
}
function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}
function queuedIndex() {
  const index = createMemoryIndex(createEmptySnapshot('org', 'event'))
  enqueuePendingRegistration(index, { id: 'registration', payload: { email: 'ada@example.test' } })
  return index
}
const paidOrder = {
  code: 'ORDER',
  status: 'p',
  positions: [{ id: 1, secret: 'ticket', attendee_name: 'Ada' }]
}

describe('offline registration retry', () => {
  it.each(['http', 'network'])(
    'resumes the created order after a %s payment failure',
    async (failure) => {
      const index = queuedIndex()
      const fetchMock = vi.fn().mockResolvedValueOnce(response({ code: 'ORDER', status: 'n' }))
      if (failure === 'http')
        fetchMock.mockResolvedValueOnce(response({ detail: 'temporary' }, 503))
      else fetchMock.mockRejectedValueOnce(new Error('network'))
      fetchMock
        .mockResolvedValueOnce(response({ code: 'ORDER', status: 'n' }))
        .mockResolvedValueOnce(response(paidOrder))
      vi.stubGlobal('fetch', fetchMock)
      expect((await flushPendingRegistrations(index, context)).flushed).toBe(0)
      expect(index.pendingRegistrations[0].createdCode).toBe('ORDER')
      expect((await flushPendingRegistrations(index, context)).flushed).toBe(1)
      expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
        ['https://tickets.test/api/v1/organizers/org/events/event/orders/', 'POST'],
        ['https://tickets.test/api/v1/organizers/org/events/event/orders/ORDER/mark_paid/', 'POST'],
        ['https://tickets.test/api/v1/organizers/org/events/event/orders/ORDER/', 'GET'],
        ['https://tickets.test/api/v1/organizers/org/events/event/orders/ORDER/mark_paid/', 'POST']
      ])
      expect(index.pendingRegistrations).toEqual([])
      expect(index.positionsBySecret.get('ticket').attendeeName).toBe('Ada')
    }
  )

  it('uses an already-paid order without creating or paying another order', async () => {
    const index = queuedIndex()
    index.pendingRegistrations[0].createdCode = 'ORDER'
    const fetchMock = vi.fn().mockResolvedValue(response(paidOrder))
    vi.stubGlobal('fetch', fetchMock)
    expect((await flushPendingRegistrations(index, context)).flushed).toBe(1)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
    expect(index.positionsBySecret.has('ticket')).toBe(true)
  })

  it('retains a known order on a failed lookup instead of creating a replacement', async () => {
    const index = queuedIndex()
    index.pendingRegistrations[0].createdCode = 'ORDER'
    const fetchMock = vi.fn().mockResolvedValue(response({ detail: 'unavailable' }, 503))
    vi.stubGlobal('fetch', fetchMock)
    expect((await flushPendingRegistrations(index, context)).flushed).toBe(0)
    expect(index.pendingRegistrations[0].createdCode).toBe('ORDER')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })
  it('retains canceled registrations as terminal errors without retrying payment', async () => {
    const index = queuedIndex()
    index.pendingRegistrations[0].createdCode = 'ORDER'
    const fetchMock = vi.fn().mockResolvedValue(response({ code: 'ORDER', status: 'c' }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await flushPendingRegistrations(index, context)).flushed).toBe(0)
    expect(index.pendingRegistrations[0].lastError).toBe('order_canceled')
    expect((await flushPendingRegistrations(index, context)).flushed).toBe(0)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })

  it('keeps expired orders eligible for payment', async () => {
    const index = queuedIndex()
    index.pendingRegistrations[0].createdCode = 'ORDER'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ code: 'ORDER', status: 'e' }))
      .mockResolvedValueOnce(response(paidOrder))
    vi.stubGlobal('fetch', fetchMock)
    expect((await flushPendingRegistrations(index, context)).flushed).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('/ORDER/mark_paid/')
  })
})

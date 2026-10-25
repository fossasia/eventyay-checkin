import { useLeadScanStore } from '@/stores/leadscan'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), exhibitor: vi.fn() }))
vi.mock('@/stores/camera', () => ({ useCameraStore: () => ({}) }))
vi.mock('@/stores/eventyayapi', () => ({
  useEventyayApi: () => ({
    url: 'https://tickets.example.test',
    apitoken: 'device-token',
    organizer: 'org',
    eventSlug: 'event',
    exikey: 'exhibitor-key',
    refreshServerUrl: vi.fn()
  })
}))
vi.mock('@/utils/serverUrl', () => ({
  createAuthorizedDeviceApi: () => ({ get: api.get }),
  createAuthorizedExhibitorApi: api.exhibitor,
  apiV1Path: (path) => `/api/v1/${path}`,
  exhibitorApiPath: (organizer, event, path) =>
    `/api/v1/event/${organizer}/${event}/exhibitors/${path}`
}))

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  api.get.mockResolvedValue({
    results: [{ secret: 'ticket-alex', pseudonymization_id: 'LEAD-A', order: 'ORDER-A' }]
  })
  api.exhibitor.mockReturnValue({
    get: vi.fn(async () => ({ success: true, leads: [] })),
    post: api.post
  })
})

describe('lead scanning', () => {
  it('records the attendee when the scanned ticket matches exactly', async () => {
    api.post.mockResolvedValue({ success: true, attendee: { name: 'Alex' } })
    const store = useLeadScanStore()
    await store.scanLeadByCode(JSON.stringify({ ticket: 'ticket-alex' }))

    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/event/org/event/exhibitors/lead/create',
      expect.objectContaining({ lead: 'LEAD-A', scan_type: 'lead' })
    )
    expect(store.showSuccess).toBe(true)
    expect(store.showError).toBe(false)
    expect(store.currentLeadId).toBe('LEAD-A')
  })
  it('shows the invalid-code message without recording an unrelated attendee', async () => {
    const store = useLeadScanStore()
    await store.scanLeadByCode(JSON.stringify({ ticket: 'ticket' }))

    expect(store.showError).toBe(true)
    expect(store.showSuccess).toBe(false)
    expect(store.message.message).toBe(
      'Invalid or unrecognized QR code. Scan an attendee badge QR or enter a valid lead code.'
    )
    expect(store.currentLeadId).toBe('')
    expect(api.exhibitor).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })
})

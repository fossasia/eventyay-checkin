import { createEmptySnapshot, mergeOrdersIntoSnapshot } from '@/offline/normalize'
import { saveEncryptedSnapshot } from '@/offline/snapshotStore'
import { runOfflineSync } from '@/offline/syncEngine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ snapshot: null }))

vi.mock('@/offline/snapshotStore', () => ({
  loadEncryptedSnapshot: vi.fn(() => state.snapshot),
  ensureDeviceSalt: vi.fn(() => 'salt'),
  saveEncryptedSnapshot: vi.fn(),
  wipeAllEncryptedSnapshots: vi.fn()
}))
vi.mock('@/offline/snapshotCrypto', () => ({
  deriveSnapshotKey: vi.fn(() => 'key'),
  decryptJson: vi.fn((snapshot) => structuredClone(snapshot)),
  encryptJson: vi.fn((snapshot) => snapshot)
}))
vi.mock('@/offline/offlineActions', () => ({
  flushPendingRedeems: vi.fn(),
  flushPendingRegistrations: vi.fn()
}))
vi.mock('@/offline/badgePrintAssets', () => ({ flushPendingPrintSync: vi.fn() }))

const credentials = {
  url: 'https://tickets.example.test',
  apitoken: 'device-token',
  organizer: 'org',
  eventSlug: 'event',
  selectedRole: 'CheckIn'
}

function order(page) {
  return {
    code: `ORDER${page}`,
    status: 'p',
    positions: [{ id: page, secret: `ticket-${page}`, checkins: [] }]
  }
}

function mockPages(pageCounts) {
  const fetchMock = vi.fn(async (request) => {
    const url = new URL(request)
    const resource = url.pathname.split('/').filter(Boolean).at(-1)
    const page = Number(url.searchParams.get('page') || 1)
    const count = pageCounts[resource] || 0
    const results =
      resource === 'orders' ? [order(page)] : [{ id: page, secret: `revoked-${page}` }]
    return {
      ok: true,
      headers: new Headers({ 'X-Page-Generated': '2030-01-02T00:00:00Z' }),
      json: async () => ({
        results: page <= count ? results : [],
        count,
        next: page < count ? `${url.pathname}?page=${page + 1}` : null
      })
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('offline sync pagination', () => {
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => {
    vi.clearAllMocks()
    state.snapshot = null
  })

  it('does not persist an incomplete initial order sync', async () => {
    const fetchMock = mockPages({ orders: 51 })
    const result = await runOfflineSync(credentials)

    expect(result).toMatchObject({ ok: false, error: 'orders_sync_failed', warnings: ['orders'] })
    expect(saveEncryptedSnapshot).not.toHaveBeenCalled()
    const orderRequests = fetchMock.mock.calls.filter(([url]) => url.includes('/orders/'))
    expect(orderRequests).toHaveLength(100) // PDF attempt and lean fallback both retain the limit.
    expect(orderRequests.some(([url]) => new URL(url).searchParams.get('page') === '51')).toBe(
      false
    )
  })

  it('accepts a complete order sync ending exactly at the page limit', async () => {
    mockPages({ orders: 50 })
    const result = await runOfflineSync(credentials)

    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.index.positionsBySecret.size).toBe(50)
    expect(result.index.positionsBySecret.has('ticket-50')).toBe(true)
    expect(saveEncryptedSnapshot).toHaveBeenCalledOnce()
  })

  it('preserves existing tickets and cursors when incremental pages are incomplete', async () => {
    state.snapshot = createEmptySnapshot('org', 'event')
    mergeOrdersIntoSnapshot(state.snapshot, [order(100)])
    state.snapshot.revokedSecrets = { 'already-revoked': true }
    state.snapshot.cursors = {
      ordersModifiedSince: '2030-01-01T00:00:00Z',
      revokedCreatedSince: '2030-01-01T00:00:00Z'
    }
    mockPages({ orders: 51, revokedsecrets: 51 })
    const result = await runOfflineSync(credentials)

    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual(['orders', 'revoked'])
    expect([...result.index.positionsBySecret.keys()]).toEqual(['ticket-100'])
    const persisted = saveEncryptedSnapshot.mock.calls[0][2]
    expect(persisted.cursors).toEqual(state.snapshot.cursors)
    expect(persisted.revokedSecrets).toEqual({ 'already-revoked': true })
  })

  it('retains complete product and check-in lists instead of replacing them with partial pages', async () => {
    state.snapshot = createEmptySnapshot('org', 'event')
    state.snapshot.products = [{ id: 100, name: 'Existing product' }]
    state.snapshot.checkInLists = [{ id: 100, name: 'Existing gate' }]
    mockPages({ products: 51, checkinlists: 51 })
    const result = await runOfflineSync(credentials)

    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual(['products', 'checkinlists'])
    expect(result.index.products).toEqual(state.snapshot.products)
    expect(result.index.checkInLists).toEqual(state.snapshot.checkInLists)
  })
})

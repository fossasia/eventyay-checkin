import { createMemoryIndex } from '@/offline/memoryIndex'
import { loadOfflineIndex, persistOfflineIndex } from '@/offline/syncEngine'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useOfflineSyncStore } from '@/stores/offlineSync'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/offline/syncEngine', async (importOriginal) => ({
  ...(await importOriginal()),
  loadOfflineIndex: vi.fn(),
  persistOfflineIndex: vi.fn(async () => {})
}))

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.stubGlobal('navigator', { onLine: false })
  vi.stubGlobal('fetch', vi.fn())
  const api = useEventyayApi()
  api.setApiCred('device-token', 'https://tickets.example.test', 'org')
  api.setEvent('event', 'Event')
  api.setRole('CheckIn')
  api.setSelectedCheckInListId(3)
})

afterEach(() => vi.unstubAllGlobals())

function prepareIndex(settings, checkins) {
  const offline = useOfflineSyncStore()
  offline.index = createMemoryIndex({
    checkInLists: [{ id: 3, ...settings }],
    positionsBySecret: {
      ticket: { id: 1, secret: 'ticket', orderStatus: 'p', attendeeName: 'Ada', checkins }
    }
  })
  offline.setOnline(false)
  return offline
}

const entry = { list: 3, type: 'entry', datetime: '2020-01-01T09:00:00Z' }
const exit = { list: 3, type: 'exit', datetime: '2020-01-01T10:00:00Z' }

describe('offline entry policy through the check-in store', () => {
  it('queues and persists each scan for a multiple-entry list', async () => {
    const offline = prepareIndex({ allow_multiple_entries: true }, [entry])
    const store = useProcessEventyayCheckInStore()
    expect((await store.checkInBySecret('ticket')).status).toBe('ok')
    expect((await store.checkInBySecret('ticket')).status).toBe('ok')
    expect(offline.index.pendingRedeems).toEqual([
      expect.objectContaining({ secret: 'ticket', lists: [3], type: 'entry' }),
      expect.objectContaining({ secret: 'ticket', lists: [3], type: 'entry' })
    ])
    expect(offline.index.positionsBySecret.get('ticket').checkins).toHaveLength(3)
    expect(persistOfflineIndex).toHaveBeenCalledTimes(2)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('hydrates once and retains both concurrent scans from a cold snapshot', async () => {
    const offline = prepareIndex({ allow_multiple_entries: true }, [entry])
    const snapshot = () =>
      createMemoryIndex({
        checkInLists: [{ id: 3, allow_multiple_entries: true }],
        positionsBySecret: {
          ticket: { id: 1, secret: 'ticket', orderStatus: 'p', checkins: [entry] }
        }
      })
    offline.index = null
    let release
    const loaded = new Promise((resolve) => {
      release = resolve
    })
    vi.mocked(loadOfflineIndex).mockImplementation(async () => {
      await loaded
      return snapshot()
    })
    const store = useProcessEventyayCheckInStore()
    const first = store.checkInBySecret('ticket')
    const second = store.checkInBySecret('ticket')
    release()
    const results = await Promise.all([first, second])
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok'])
    expect(loadOfflineIndex).toHaveBeenCalledTimes(1)
    expect(offline.index.pendingRedeems).toEqual([
      expect.objectContaining({ secret: 'ticket', lists: [3], type: 'entry' }),
      expect.objectContaining({ secret: 'ticket', lists: [3], type: 'entry' })
    ])
    expect(offline.index.positionsBySecret.get('ticket').checkins).toHaveLength(3)
    expect(persistOfflineIndex).toHaveBeenCalledTimes(2)
  })

  it('persists a scan before the next scan mutates the snapshot', async () => {
    const offline = prepareIndex({ allow_multiple_entries: true }, [entry])
    let release
    const persisted = new Promise((resolve) => {
      release = resolve
    })
    vi.mocked(persistOfflineIndex).mockImplementationOnce(async () => persisted)
    const store = useProcessEventyayCheckInStore()
    const first = store.checkInBySecret('ticket')
    const second = store.checkInBySecret('ticket')
    await vi.waitFor(() => expect(persistOfflineIndex).toHaveBeenCalledTimes(1))
    expect(offline.index.pendingRedeems).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(offline.index.pendingRedeems).toHaveLength(2)
    expect(persistOfflineIndex).toHaveBeenCalledTimes(2)
  })

  it('continues processing scans after a persistence failure', async () => {
    const offline = prepareIndex({ allow_multiple_entries: true }, [entry])
    vi.mocked(persistOfflineIndex).mockRejectedValueOnce(new Error('storage unavailable'))
    const store = useProcessEventyayCheckInStore()
    await expect(store.checkInBySecret('ticket')).rejects.toThrow('storage unavailable')
    expect((await store.checkInBySecret('ticket')).status).toBe('ok')
    expect(offline.index.pendingRedeems).toHaveLength(2)
    expect(persistOfflineIndex).toHaveBeenCalledTimes(2)
  })

  it('queues one re-entry after an exit, then protects against a duplicate scan', async () => {
    const offline = prepareIndex({ allow_entry_after_exit: true }, [exit, entry])
    const store = useProcessEventyayCheckInStore()
    expect((await store.checkInBySecret('ticket')).status).toBe('ok')
    expect((await store.checkInBySecret('ticket')).status).toBe('redeemed')
    expect(offline.index.pendingRedeems).toHaveLength(1)
    expect(offline.index.pendingRedeems[0]).toEqual(
      expect.objectContaining({
        secret: 'ticket',
        lists: [3],
        type: 'entry'
      })
    )
    expect(persistOfflineIndex).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not queue a duplicate when neither permission is enabled', async () => {
    const offline = prepareIndex({}, [entry, exit])
    const store = useProcessEventyayCheckInStore()
    expect((await store.checkInBySecret('ticket')).status).toBe('redeemed')
    expect(offline.index.pendingRedeems).toHaveLength(0)
    expect(persistOfflineIndex).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})

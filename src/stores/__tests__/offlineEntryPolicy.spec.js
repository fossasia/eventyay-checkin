import { createMemoryIndex } from '@/offline/memoryIndex'
import { persistOfflineIndex } from '@/offline/syncEngine'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useOfflineSyncStore } from '@/stores/offlineSync'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/offline/syncEngine', async (importOriginal) => ({
  ...(await importOriginal()),
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
    expect(offline.index.pendingRedeems).toHaveLength(2)
    expect(offline.index.positionsBySecret.get('ticket').checkins).toHaveLength(3)
    expect(persistOfflineIndex).toHaveBeenCalledTimes(2)
    expect(fetch).not.toHaveBeenCalled()
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

import {
  buildCheckInListCacheKey,
  createCheckInListRequestCoordinator,
  isCheckInListCacheEntryValid,
  shouldRetryCheckInWithFreshLists
} from '@/utils/checkInListCache'
import { describe, expect, it, vi } from 'vitest'

describe('buildCheckInListCacheKey', () => {
  it('combines organizer and event slug', () => {
    expect(buildCheckInListCacheKey('acme', 'conf2026')).toBe('acme:conf2026')
  })
})

describe('isCheckInListCacheEntryValid', () => {
  it('requires matching key, list ids, and fetch timestamp', () => {
    const cache = { key: 'acme:conf2026', listIds: [1], fetchedAt: Date.now() }
    expect(isCheckInListCacheEntryValid(cache, 'acme:conf2026')).toBe(true)
    expect(isCheckInListCacheEntryValid(cache, 'other:event')).toBe(false)
    expect(isCheckInListCacheEntryValid({ ...cache, listIds: [] }, 'acme:conf2026')).toBe(false)
  })
})

describe('shouldRetryCheckInWithFreshLists', () => {
  it('retries transient and network errors but not auth failures', () => {
    expect(shouldRetryCheckInWithFreshLists({ status: 500 })).toBe(true)
    expect(shouldRetryCheckInWithFreshLists({})).toBe(true)
    expect(shouldRetryCheckInWithFreshLists({ status: 401 })).toBe(false)
    expect(shouldRetryCheckInWithFreshLists({ status: 403 })).toBe(false)
    expect(shouldRetryCheckInWithFreshLists({ status: 404 })).toBe(false)
  })
})

describe('createCheckInListRequestCoordinator', () => {
  it('deduplicates in-flight fetches for the same cache key', async () => {
    const coordinator = createCheckInListRequestCoordinator()
    const fetcher = vi.fn(async () => 'lists')

    const first = coordinator.run('acme:conf2026', fetcher)
    const second = coordinator.run('acme:conf2026', fetcher)

    await Promise.all([first, second])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(await first).toBe('lists')
    expect(await second).toBe('lists')
  })
})

describe('request replacement', () => {
  it.each(['reset', 'switch'])(
    'keeps the newer request after an older %s request settles',
    async (replacement) => {
      const coordinator = createCheckInListRequestCoordinator()
      let finishOld
      let finishNew
      const first = coordinator.run(
        'org:event',
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          })
      )
      await Promise.resolve()
      if (replacement === 'reset') {
        coordinator.reset()
      } else {
        await coordinator.run('org:other', async () => 'other')
      }
      const fetchNew = vi.fn(
        () =>
          new Promise((resolve) => {
            finishNew = resolve
          })
      )
      const second = coordinator.run('org:event', fetchNew)
      await Promise.resolve()
      finishOld('old')
      await first
      const third = coordinator.run('org:event', fetchNew)
      await Promise.resolve()
      expect(fetchNew).toHaveBeenCalledOnce()
      finishNew('new')
      await expect(second).resolves.toBe('new')
      await expect(third).resolves.toBe('new')
    }
  )

  it('releases a rejected request so the next call can retry', async () => {
    const coordinator = createCheckInListRequestCoordinator()
    await expect(
      coordinator.run('org:event', () => Promise.reject(new Error('offline')))
    ).rejects.toThrow('offline')
    await expect(coordinator.run('org:event', async () => 'retry')).resolves.toBe('retry')
  })
})

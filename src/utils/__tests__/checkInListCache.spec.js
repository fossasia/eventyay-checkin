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

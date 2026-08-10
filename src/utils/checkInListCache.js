export function buildCheckInListCacheKey(organizer, eventSlug) {
  return `${organizer}:${eventSlug}`
}

export function isCheckInListCacheEntryValid(cache, cacheKey) {
  return cache.key === cacheKey && cache.listIds.length > 0 && cache.fetchedAt > 0
}

export function createEmptyCheckInListCache() {
  return { key: '', listIds: [], fetchedAt: 0 }
}

export function createCheckInListCache(cacheKey, listIds, fetchedAt = Date.now()) {
  return { key: cacheKey, listIds, fetchedAt }
}

export function shouldRetryCheckInWithFreshLists(error) {
  const status = error?.response?.status ?? error?.status

  if (status === 401 || status === 403) {
    return false
  }

  if (!status) {
    return true
  }

  return status >= 500
}

export function createCheckInListRequestCoordinator() {
  let inFlightRequest = null
  let inFlightCacheKey = ''

  async function run(cacheKey, fetcher) {
    if (inFlightRequest && inFlightCacheKey === cacheKey) {
      return inFlightRequest
    }

    inFlightCacheKey = cacheKey
    inFlightRequest = Promise.resolve()
      .then(fetcher)
      .finally(() => {
        if (inFlightCacheKey === cacheKey) {
          inFlightRequest = null
          inFlightCacheKey = ''
        }
      })

    return inFlightRequest
  }

  function reset() {
    inFlightRequest = null
    inFlightCacheKey = ''
  }

  return { run, reset }
}

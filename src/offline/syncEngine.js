import { resolveServerUrl } from '@/utils/serverUrl'
import { computeSyncPercent, pageFraction } from '@/offline/syncProgress'
import {
  createEmptySnapshot,
  mergeLayoutsIntoSnapshot,
  mergeOrdersIntoSnapshot,
  mergeRevokedIntoSnapshot
} from '@/offline/normalize'
import { createMemoryIndex, memoryIndexToSnapshot } from '@/offline/memoryIndex'
import { decryptJson, deriveSnapshotKey, encryptJson } from '@/offline/snapshotCrypto'
import {
  ensureDeviceSalt,
  loadEncryptedSnapshot,
  saveEncryptedSnapshot,
  wipeAllEncryptedSnapshots
} from '@/offline/snapshotStore'
import { flushPendingRedeems, flushPendingRegistrations } from '@/offline/offlineActions'
import { flushPendingPrintSync } from '@/offline/badgePrintAssets'

const MAX_PAGES = 50

function reportPhaseProgress(onProgress, phase, fraction = 0, detail = {}) {
  onProgress?.({
    phase,
    fraction: Math.min(1, Math.max(0, fraction)),
    percent: computeSyncPercent(phase, fraction),
    ...detail
  })
}

export function canUseOfflineSync(selectedRole, securityProfile) {
  if (selectedRole === 'Badge Station' || securityProfile === 'eventyay_checkin_online_kiosk') {
    return false
  }
  return selectedRole === 'CheckIn' || securityProfile === 'eventyay_checkin' || securityProfile === 'full'
}

function joinUrl(baseUrl, path) {
  const base = resolveServerUrl(baseUrl).replace(/\/+$/, '')
  if (/^https?:\/\//i.test(path)) {
    try {
      const parsed = new URL(path)
      return `${base}${parsed.pathname}${parsed.search}`
    } catch {
      return path
    }
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

async function fetchJsonPage(baseUrl, apitoken, path) {
  const response = await fetch(joinUrl(baseUrl, path), {
    credentials: 'omit',
    headers: {
      Authorization: `Device ${apitoken}`,
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const error = new Error(detail || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  const body = await response.json()
  return {
    body,
    pageGenerated: response.headers.get('X-Page-Generated')
  }
}

async function fetchAllPages(
  baseUrl,
  apitoken,
  path,
  { sinceParam, sinceValue, maxPages = MAX_PAGES, onPage } = {}
) {
  const results = []
  let nextPath = path
  let pageGenerated = null
  let pages = 0
  let totalCount = null

  while (nextPath && pages < maxPages) {
    pages += 1
    let requestPath = nextPath
    if (sinceParam && sinceValue && pages === 1) {
      const url = new URL(requestPath, 'https://placeholder.local')
      url.searchParams.set(sinceParam, sinceValue)
      requestPath = `${url.pathname}${url.search}`
    }
    const { body, pageGenerated: headerCursor } = await fetchJsonPage(baseUrl, apitoken, requestPath)
    pageGenerated = headerCursor || pageGenerated
    const batch = Array.isArray(body) ? body : body.results || []
    results.push(...batch)
    if (typeof body?.count === 'number') {
      totalCount = body.count
    }
    if (body?.next) {
      try {
        const nextUrl = new URL(body.next, 'https://placeholder.local')
        nextPath = `${nextUrl.pathname}${nextUrl.search}`
      } catch {
        nextPath = null
      }
    } else {
      nextPath = null
    }
    onPage?.({
      page: pages,
      fetched: results.length,
      count: totalCount,
      hasMore: Boolean(nextPath)
    })
  }

  return { results, pageGenerated, pages, count: totalCount }
}

async function safeFetchAllPages(...args) {
  try {
    return await fetchAllPages(...args)
  } catch (error) {
    return { results: [], pageGenerated: null, error }
  }
}

export async function loadOfflineIndex({ organizer, eventSlug, apitoken }) {
  const envelope = await loadEncryptedSnapshot(organizer, eventSlug)
  if (!envelope) {
    return createMemoryIndex(createEmptySnapshot(organizer, eventSlug))
  }
  const salt = ensureDeviceSalt()
  const key = await deriveSnapshotKey(apitoken, salt)
  const snapshot = await decryptJson(envelope, key)
  return createMemoryIndex(snapshot)
}

export async function persistOfflineIndex(index, { apitoken }) {
  await flushPendingPrintSync(index, apitoken)
  const salt = ensureDeviceSalt()
  const key = await deriveSnapshotKey(apitoken, salt)
  const snapshot = memoryIndexToSnapshot(index)
  const envelope = await encryptJson(snapshot, key)
  await saveEncryptedSnapshot(index.organizer, index.eventSlug, envelope)
}

async function syncOrders(url, apitoken, organizer, eventSlug, snapshot, { onPage } = {}) {
  const base = `/api/v1/organizers/${organizer}/events/${eventSlug}/orders/?ordering=last_modified`
  const withPdf = await safeFetchAllPages(url, apitoken, `${base}&pdf_data=true`, {
    sinceParam: 'modified_since',
    sinceValue: snapshot.cursors.ordersModifiedSince,
    onPage
  })
  if (!withPdf.error) {
    return withPdf
  }
  // Lean fallback: still sync secrets/names/checkins so scanning works offline.
  return safeFetchAllPages(url, apitoken, base, {
    sinceParam: 'modified_since',
    sinceValue: snapshot.cursors.ordersModifiedSince,
    onPage
  })
}

export async function runOfflineSync({
  url,
  apitoken,
  organizer,
  eventSlug,
  selectedRole,
  securityProfile,
  onProgress
} = {}) {
  if (!canUseOfflineSync(selectedRole, securityProfile)) {
    return { ok: false, skipped: true, reason: 'profile_no_sync' }
  }
  if (!url || !apitoken || !organizer || !eventSlug) {
    return { ok: false, error: 'missing_credentials' }
  }

  const index = await loadOfflineIndex({ organizer, eventSlug, apitoken })
  const snapshot = memoryIndexToSnapshot(index)
  const warnings = []

  const trackPagedPhase = (phase) => (pageInfo) => {
    reportPhaseProgress(onProgress, phase, pageFraction(pageInfo), pageInfo)
  }

  reportPhaseProgress(onProgress, 'layouts', 0)
  const layoutsPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/badgelayouts/`
  const layoutsResult = await safeFetchAllPages(url, apitoken, layoutsPath, {
    onPage: trackPagedPhase('layouts')
  })
  if (layoutsResult.error) {
    warnings.push('layouts')
  } else {
    mergeLayoutsIntoSnapshot(snapshot, layoutsResult.results)
  }
  reportPhaseProgress(onProgress, 'layouts', 1)

  reportPhaseProgress(onProgress, 'products', 0)
  const productsPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/products/`
  const productsResult = await safeFetchAllPages(url, apitoken, productsPath, {
    onPage: trackPagedPhase('products')
  })
  if (!productsResult.error) {
    snapshot.products = (productsResult.results || []).filter(
      (product) => product?.active !== false && product?.admission !== false
    )
  } else {
    warnings.push('products')
  }
  reportPhaseProgress(onProgress, 'products', 1)

  reportPhaseProgress(onProgress, 'checkinlists', 0)
  const listsPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/checkinlists/`
  const listsResult = await safeFetchAllPages(url, apitoken, listsPath, {
    onPage: trackPagedPhase('checkinlists')
  })
  if (!listsResult.error) {
    snapshot.checkInLists = listsResult.results || []
  } else {
    warnings.push('checkinlists')
  }
  reportPhaseProgress(onProgress, 'checkinlists', 1)

  reportPhaseProgress(onProgress, 'orders', 0)
  const ordersResult = await syncOrders(url, apitoken, organizer, eventSlug, snapshot, {
    onPage: trackPagedPhase('orders')
  })
  if (ordersResult.error) {
    warnings.push('orders')
  } else {
    mergeOrdersIntoSnapshot(snapshot, ordersResult.results)
    if (ordersResult.pageGenerated) {
      snapshot.cursors.ordersModifiedSince = ordersResult.pageGenerated
    }
  }
  reportPhaseProgress(onProgress, 'orders', 1)

  reportPhaseProgress(onProgress, 'revoked', 0)
  const revokedPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/revokedsecrets/`
  const revokedResult = await safeFetchAllPages(url, apitoken, revokedPath, {
    sinceParam: 'created_since',
    sinceValue: snapshot.cursors.revokedCreatedSince,
    onPage: trackPagedPhase('revoked')
  })
  if (revokedResult.error) {
    warnings.push('revoked')
  } else {
    mergeRevokedIntoSnapshot(snapshot, revokedResult.results)
    if (revokedResult.pageGenerated) {
      snapshot.cursors.revokedCreatedSince = revokedResult.pageGenerated
    }
  }
  reportPhaseProgress(onProgress, 'revoked', 1)

  if (warnings.includes('orders') && Object.keys(snapshot.positionsBySecret).length === 0) {
    return { ok: false, error: 'orders_sync_failed', warnings }
  }

  snapshot.lastSyncedAt = new Date().toISOString()
  let nextIndex = createMemoryIndex(snapshot)

  reportPhaseProgress(onProgress, 'flush', 0)
  await flushPendingRedeems(nextIndex, { url, apitoken, organizer })
  reportPhaseProgress(onProgress, 'flush', 0.5)
  await flushPendingRegistrations(nextIndex, { url, apitoken, organizer, eventSlug })

  const followUp = await syncOrders(url, apitoken, organizer, eventSlug, memoryIndexToSnapshot(nextIndex), {
    onPage: trackPagedPhase('flush')
  })
  if (!followUp.error && followUp.results.length) {
    const followSnapshot = memoryIndexToSnapshot(nextIndex)
    mergeOrdersIntoSnapshot(followSnapshot, followUp.results)
    if (followUp.pageGenerated) {
      followSnapshot.cursors.ordersModifiedSince = followUp.pageGenerated
    }
    followSnapshot.lastSyncedAt = new Date().toISOString()
    nextIndex = createMemoryIndex(followSnapshot)
  }
  reportPhaseProgress(onProgress, 'flush', 1)

  reportPhaseProgress(onProgress, 'persist', 0.2)
  await persistOfflineIndex(nextIndex, { apitoken })
  reportPhaseProgress(onProgress, 'persist', 1)

  return {
    ok: true,
    index: nextIndex,
    warnings,
    counts: {
      orders: ordersResult.results?.length || 0,
      revoked: revokedResult.results?.length || 0,
      layouts: layoutsResult.results?.length || 0,
      products: snapshot.products.length,
      checkInLists: snapshot.checkInLists.length,
      positions: nextIndex.positionsBySecret.size
    }
  }
}

export async function wipeOfflineData() {
  await wipeAllEncryptedSnapshots()
}

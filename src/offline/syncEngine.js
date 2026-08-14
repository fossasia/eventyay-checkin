import { resolveServerUrl } from '@/utils/serverUrl'
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

const MAX_PAGES = 50

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

async function fetchAssetBytes(baseUrl, apitoken, pathOrUrl) {
  const raw = String(pathOrUrl || '').trim()
  if (!raw) {
    return null
  }
  const url = /^https?:\/\//i.test(raw) ? raw : joinUrl(baseUrl, raw)
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      headers: {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/pdf, image/*, font/ttf, application/octet-stream, */*'
      }
    })
    if (!response.ok) {
      return null
    }
    const buffer = await response.arrayBuffer()
    if (!buffer.byteLength) {
      return null
    }
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

async function syncLayoutBackgrounds(baseUrl, apitoken, organizer, eventSlug, snapshot) {
  for (const layout of Object.values(snapshot.layouts || {})) {
    const layoutId = layout?.id
    if (!layoutId) {
      continue
    }
    const endpointPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/badgelayouts/${layoutId}/background/`
    let bytes = await fetchAssetBytes(baseUrl, apitoken, endpointPath)
    if (!bytes && layout.background) {
      bytes = await fetchAssetBytes(baseUrl, apitoken, layout.background)
    }
    if (bytes) {
      layout.backgroundPdf = bytesToBase64(bytes)
    }
  }
}

const PRINT_FONT_PATHS = {
  regular: '/static/fonts/opensans_regular_macroman/OpenSans-Regular-webfont.ttf',
  bold: '/static/fonts/opensans_bold_macroman/OpenSans-Bold-webfont.ttf',
  italic: '/static/fonts/opensans_italic_macroman/OpenSans-Italic-webfont.ttf',
  boldItalic: '/static/fonts/opensans_bolditalic_macroman/OpenSans-BoldItalic-webfont.ttf'
}

async function syncPrintAssets(baseUrl, apitoken, snapshot) {
  const assets = { ...(snapshot.printAssets || {}) }
  for (const [key, path] of Object.entries(PRINT_FONT_PATHS)) {
    if (assets[key]) {
      continue
    }
    const bytes = await fetchAssetBytes(baseUrl, apitoken, path)
    if (bytes) {
      assets[key] = bytesToBase64(bytes)
    }
  }
  snapshot.printAssets = assets
}

async function syncPdfImages(baseUrl, apitoken, snapshot) {
  for (const record of Object.values(snapshot.positionsBySecret || {})) {
    const images = record?.pdfData?.images
    if (!images || typeof images !== 'object') {
      continue
    }
    for (const [key, value] of Object.entries(images)) {
      if (!value || String(value).startsWith('data:')) {
        continue
      }
      const bytes = await fetchAssetBytes(baseUrl, apitoken, value)
      if (!bytes) {
        continue
      }
      const mime = String(value).toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg'
      images[key] = `data:${mime};base64,${bytesToBase64(bytes)}`
    }
  }
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

async function fetchAllPages(baseUrl, apitoken, path, { sinceParam, sinceValue, maxPages = MAX_PAGES } = {}) {
  const results = []
  let nextPath = path
  let pageGenerated = null
  let pages = 0

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
    if (body.next) {
      try {
        const nextUrl = new URL(body.next, 'https://placeholder.local')
        nextPath = `${nextUrl.pathname}${nextUrl.search}`
      } catch {
        nextPath = null
      }
    } else {
      nextPath = null
    }
  }

  return { results, pageGenerated }
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
  const salt = ensureDeviceSalt()
  const key = await deriveSnapshotKey(apitoken, salt)
  const snapshot = memoryIndexToSnapshot(index)
  const envelope = await encryptJson(snapshot, key)
  await saveEncryptedSnapshot(index.organizer, index.eventSlug, envelope)
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

  onProgress?.({ phase: 'layouts' })
  const layoutsPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/badgelayouts/`
  const { results: layouts } = await fetchAllPages(url, apitoken, layoutsPath)
  mergeLayoutsIntoSnapshot(snapshot, layouts)
  await syncLayoutBackgrounds(url, apitoken, organizer, eventSlug, snapshot)
  await syncPrintAssets(url, apitoken, snapshot)

  onProgress?.({ phase: 'orders' })
  const ordersPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/orders/?ordering=last_modified&pdf_data=true`
  const { results: orders, pageGenerated: ordersCursor } = await fetchAllPages(url, apitoken, ordersPath, {
    sinceParam: 'modified_since',
    sinceValue: snapshot.cursors.ordersModifiedSince
  })
  mergeOrdersIntoSnapshot(snapshot, orders)
  await syncPdfImages(url, apitoken, snapshot)
  if (ordersCursor) {
    snapshot.cursors.ordersModifiedSince = ordersCursor
  }

  onProgress?.({ phase: 'revoked' })
  const revokedPath = `/api/v1/organizers/${organizer}/events/${eventSlug}/revokedsecrets/`
  const { results: revoked, pageGenerated: revokedCursor } = await fetchAllPages(url, apitoken, revokedPath, {
    sinceParam: 'created_since',
    sinceValue: snapshot.cursors.revokedCreatedSince
  })
  mergeRevokedIntoSnapshot(snapshot, revoked)
  if (revokedCursor) {
    snapshot.cursors.revokedCreatedSince = revokedCursor
  }

  snapshot.lastSyncedAt = new Date().toISOString()
  const nextIndex = createMemoryIndex(snapshot)

  onProgress?.({ phase: 'flush' })
  await flushPendingRedeems(nextIndex, { url, apitoken, organizer })
  await flushPendingRegistrations(nextIndex, { url, apitoken, organizer, eventSlug })

  // Absorb server-side results of flushed registrations / concurrent check-ins.
  const { results: followUpOrders, pageGenerated: followUpCursor } = await fetchAllPages(
    url,
    apitoken,
    `/api/v1/organizers/${organizer}/events/${eventSlug}/orders/?ordering=last_modified&pdf_data=true`,
    {
      sinceParam: 'modified_since',
      sinceValue: nextIndex.cursors.ordersModifiedSince
    }
  )
  if (followUpOrders.length) {
    const followSnapshot = memoryIndexToSnapshot(nextIndex)
    mergeOrdersIntoSnapshot(followSnapshot, followUpOrders)
    await syncPdfImages(url, apitoken, followSnapshot)
    if (followUpCursor) {
      followSnapshot.cursors.ordersModifiedSince = followUpCursor
    }
    followSnapshot.lastSyncedAt = new Date().toISOString()
    const merged = createMemoryIndex(followSnapshot)
    await persistOfflineIndex(merged, { apitoken })
    return {
      ok: true,
      index: merged,
      counts: {
        orders: orders.length + followUpOrders.length,
        revoked: revoked.length,
        layouts: layouts.length,
        positions: merged.positionsBySecret.size
      }
    }
  }

  await persistOfflineIndex(nextIndex, { apitoken })

  return {
    ok: true,
    index: nextIndex,
    counts: {
      orders: orders.length,
      revoked: revoked.length,
      layouts: layouts.length,
      positions: nextIndex.positionsBySecret.size
    }
  }
}

export async function wipeOfflineData() {
  await wipeAllEncryptedSnapshots()
}

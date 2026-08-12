import { buildSearchText } from '@/offline/normalize'

export function createMemoryIndex(snapshot) {
  const positionsBySecret = new Map()
  const revokedSecrets = new Set()
  const layouts = new Map()

  Object.entries(snapshot?.positionsBySecret || {}).forEach(([secret, record]) => {
    positionsBySecret.set(secret, record)
  })
  Object.keys(snapshot?.revokedSecrets || {}).forEach((secret) => {
    if (snapshot.revokedSecrets[secret]) {
      revokedSecrets.add(secret)
    }
  })
  Object.entries(snapshot?.layouts || {}).forEach(([id, layout]) => {
    layouts.set(String(id), layout)
  })

  return {
    positionsBySecret,
    revokedSecrets,
    layouts,
    pendingRedeems: [...(snapshot?.pendingRedeems || [])],
    pendingRegistrations: [...(snapshot?.pendingRegistrations || [])],
    cursors: { ...(snapshot?.cursors || {}) },
    products: [...(snapshot?.products || [])],
    checkInLists: [...(snapshot?.checkInLists || [])],
    layoutProductMap: { ...(snapshot?.layoutProductMap || {}) },
    lastSyncedAt: snapshot?.lastSyncedAt || null,
    organizer: snapshot?.organizer || '',
    eventSlug: snapshot?.eventSlug || ''
  }
}

export function memoryIndexToSnapshot(index) {
  const positionsBySecret = {}
  index.positionsBySecret.forEach((record, secret) => {
    positionsBySecret[secret] = record
  })
  const revokedSecrets = {}
  index.revokedSecrets.forEach((secret) => {
    revokedSecrets[secret] = true
  })
  const layouts = {}
  index.layouts.forEach((layout, id) => {
    layouts[id] = layout
  })
  return {
    version: 1,
    organizer: index.organizer,
    eventSlug: index.eventSlug,
    layouts,
    layoutProductMap: { ...index.layoutProductMap },
    positionsBySecret,
    revokedSecrets,
    products: [...index.products],
    checkInLists: [...(index.checkInLists || [])],
    pendingRedeems: [...index.pendingRedeems],
    pendingRegistrations: [...index.pendingRegistrations],
    cursors: { ...index.cursors },
    lastSyncedAt: index.lastSyncedAt
  }
}

export function lookupBySecret(index, secret) {
  const key = String(secret || '').trim()
  if (!key) {
    return { status: 'invalid' }
  }
  if (index.revokedSecrets.has(key)) {
    return { status: 'revoked' }
  }
  const position = index.positionsBySecret.get(key)
  if (!position || position.canceled) {
    return { status: 'missing' }
  }
  return { status: 'found', position }
}

export function searchPositions(index, query, { limit = 25 } = {}) {
  const needle = String(query || '')
    .trim()
    .toLowerCase()
  if (needle.length < 2) {
    return []
  }
  const results = []
  for (const position of index.positionsBySecret.values()) {
    if (position.canceled) {
      continue
    }
    if (index.revokedSecrets.has(position.secret)) {
      continue
    }
    const haystack = position.searchText || buildSearchText(position)
    if (haystack.includes(needle)) {
      results.push(position)
      if (results.length >= limit) {
        break
      }
    }
  }
  return results
}

/** Return synced attendees for offline browse/search (all or filtered, sorted by name). */
export function listStoredPositions(index, query = '', { limit = 100 } = {}) {
  const needle = String(query || '').trim().toLowerCase()
  const results = []
  for (const position of index.positionsBySecret.values()) {
    if (position.canceled || index.revokedSecrets.has(position.secret)) {
      continue
    }
    if (needle.length >= 2) {
      const haystack = position.searchText || buildSearchText(position)
      if (!haystack.includes(needle)) {
        continue
      }
    }
    results.push(position)
  }
  results.sort((a, b) =>
    String(a.attendeeName || '').localeCompare(String(b.attendeeName || ''), undefined, {
      sensitivity: 'base'
    })
  )
  return results.slice(0, limit)
}

/** Map a snapshot position into the check-in search result row shape. */
export function positionToSearchOrder(position) {
  return {
    id: position.id,
    secret: position.secret,
    attendee_name: position.attendeeName || '',
    attendee_email: position.attendeeEmail || '',
    company: position.company || '',
    job_title: position.jobTitle || '',
    product: position.product,
    variation: position.variation,
    order: position.orderCode,
    checkins: position.checkins || [],
    pdf_data: position.pdfData || {},
    offline: true
  }
}

export function upsertPosition(index, record) {
  if (!record?.secret) {
    return
  }
  const next = {
    ...record,
    searchText: buildSearchText(record)
  }
  index.positionsBySecret.set(record.secret, next)
}

export function getDefaultLayout(index) {
  for (const layout of index.layouts.values()) {
    if (layout.default) {
      return layout
    }
  }
  const first = index.layouts.values().next()
  return first.done ? null : first.value
}

export function resolveLayoutForPosition(index, position) {
  if (position?.layoutId && index.layouts.has(String(position.layoutId))) {
    return index.layouts.get(String(position.layoutId))
  }
  const mapped = index.layoutProductMap[String(position?.product)]
  if (mapped && index.layouts.has(String(mapped))) {
    return index.layouts.get(String(mapped))
  }
  return getDefaultLayout(index)
}

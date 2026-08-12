export function createEmptySnapshot(organizer, eventSlug) {
  return {
    version: 1,
    organizer: String(organizer || ''),
    eventSlug: String(eventSlug || ''),
    layouts: {},
    layoutProductMap: {},
    positionsBySecret: {},
    revokedSecrets: {},
    products: [],
    pendingRedeems: [],
    pendingRegistrations: [],
    cursors: {
      ordersModifiedSince: null,
      revokedCreatedSince: null
    },
    lastSyncedAt: null
  }
}

export function buildSearchText(position) {
  return [position.attendeeName, position.attendeeEmail, position.company, position.orderCode, position.secret]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function normalizePositionFromOrder(order, position, { listIds = [], layoutId = null } = {}) {
  const secret = String(position?.secret || '').trim()
  if (!secret) {
    return null
  }

  const pdfData =
    position?.pdf_data && typeof position.pdf_data === 'object' && !Array.isArray(position.pdf_data)
      ? { ...position.pdf_data }
      : {}

  // Images are live URLs; keep keys but offline render may skip missing blobs.
  if (pdfData.images && typeof pdfData.images === 'object') {
    pdfData.images = { ...pdfData.images }
  }

  const record = {
    id: position.id,
    secret,
    product: position.product ?? position.item ?? null,
    variation: position.variation ?? null,
    layoutId: layoutId ?? position.downloads?.find((d) => d.output === 'badge')?.layout ?? null,
    orderCode: order?.code || position.order || '',
    orderStatus: order?.status || position.order__status || '',
    attendeeName: position.attendee_name || pdfData.attendee_name || '',
    attendeeEmail: position.attendee_email || '',
    company: position.company || pdfData.attendee_company || '',
    jobTitle: position.job_title || pdfData.attendee_job_title || '',
    checkins: Array.isArray(position.checkins) ? position.checkins.map(normalizeCheckin) : [],
    listIds: listIds.length ? listIds : inferListIds(position.checkins),
    pdfData,
    canceled: Boolean(position.canceled)
  }
  record.searchText = buildSearchText(record)
  return record
}

function normalizeCheckin(checkin) {
  return {
    list: checkin.list,
    type: checkin.type || 'entry',
    datetime: checkin.datetime || null,
    device: checkin.device ?? null
  }
}

function inferListIds(checkins) {
  if (!Array.isArray(checkins)) {
    return []
  }
  return [...new Set(checkins.map((c) => c.list).filter((id) => id != null))]
}

export function normalizeLayout(layout) {
  if (!layout?.id) {
    return null
  }
  let parsedLayout = layout.layout
  if (typeof parsedLayout === 'string') {
    try {
      parsedLayout = JSON.parse(parsedLayout)
    } catch {
      parsedLayout = []
    }
  }
  return {
    id: layout.id,
    name: layout.name || '',
    default: Boolean(layout.default),
    layout: Array.isArray(parsedLayout) ? parsedLayout : [],
    size: layout.size || null,
    background: layout.background || null,
    askUserFields: layout.ask_user_fields || null,
    allowCustomization: Boolean(layout.allow_customization),
    allowBadgeEditing: Boolean(layout.allow_badge_editing),
    productAssignments: Array.isArray(layout.product_assignments)
      ? layout.product_assignments.map((row) => row.product).filter((id) => id != null)
      : []
  }
}

export function mergeOrdersIntoSnapshot(snapshot, orders) {
  const next = snapshot
  for (const order of orders || []) {
    for (const position of order.positions || []) {
      const record = normalizePositionFromOrder(order, position)
      if (!record) {
        continue
      }
      const existing = next.positionsBySecret[record.secret]
      if (existing) {
        record.listIds = [...new Set([...(existing.listIds || []), ...(record.listIds || [])])]
        record.checkins = record.checkins?.length ? record.checkins : existing.checkins
        if (!record.layoutId) {
          record.layoutId = existing.layoutId
        }
        if (!Object.keys(record.pdfData || {}).length && existing.pdfData) {
          record.pdfData = existing.pdfData
        }
      }
      const productLayout = next.layoutProductMap[String(record.product)]
      if (!record.layoutId && productLayout) {
        record.layoutId = productLayout
      }
      record.searchText = buildSearchText(record)
      next.positionsBySecret[record.secret] = record
    }
  }
  return next
}

export function mergeRevokedIntoSnapshot(snapshot, revokedRows) {
  for (const row of revokedRows || []) {
    if (row?.secret) {
      snapshot.revokedSecrets[String(row.secret)] = true
    }
  }
  return snapshot
}

export function mergeLayoutsIntoSnapshot(snapshot, layouts) {
  const productMap = { ...snapshot.layoutProductMap }
  for (const layout of layouts || []) {
    const normalized = normalizeLayout(layout)
    if (!normalized) {
      continue
    }
    snapshot.layouts[String(normalized.id)] = normalized
    for (const productId of normalized.productAssignments) {
      productMap[String(productId)] = normalized.id
    }
  }
  snapshot.layoutProductMap = productMap
  return snapshot
}

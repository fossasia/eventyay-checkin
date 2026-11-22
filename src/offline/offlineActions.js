import { lookupBySecret, upsertPosition } from '@/offline/memoryIndex'
import { normalizePositionFromOrder } from '@/offline/normalize'
import {
  createOperationalId,
  logApiResult,
  SAFE_REDEEM_ERROR_CODES,
  toSafeErrorCode
} from '@/utils/operationalLog'

export const MISSING_OFFLINE_DATA_MESSAGE =
  'Please connect to the internet to fetch the latest check-in data, then try again.'

export function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function evaluateLocalRedeem(index, secret, { listId, type = 'entry' } = {}) {
  const lookup = lookupBySecret(index, secret)
  if (lookup.status === 'revoked') {
    return { ok: false, reason: 'revoked', message: 'This ticket has been revoked.' }
  }
  if (lookup.status !== 'found') {
    return {
      ok: false,
      reason: 'missing',
      message: MISSING_OFFLINE_DATA_MESSAGE
    }
  }

  const position = lookup.position
  if (position.orderStatus && position.orderStatus !== 'p' && position.orderStatus !== 'n') {
    return { ok: false, reason: 'unpaid', message: 'This ticket is not paid.', position }
  }

  const listIdNum = Number(listId)
  if (
    Array.isArray(position.listIds) &&
    position.listIds.length > 0 &&
    listId != null &&
    !position.listIds.map(Number).includes(listIdNum)
  ) {
    // listIds inferred from prior checkins may be incomplete; do not block if empty.
  }

  const alreadyOnList = (position.checkins || []).some(
    (checkin) => Number(checkin.list) === listIdNum && (checkin.type || 'entry') === type
  )
  if (alreadyOnList && type === 'entry') {
    return {
      ok: true,
      alreadyRedeemed: true,
      position,
      status: 'redeemed'
    }
  }

  return { ok: true, alreadyRedeemed: false, position, status: 'ok' }
}

export function applyLocalCheckin(
  index,
  position,
  { listId, type = 'entry', datetime = null } = {}
) {
  const next = {
    ...position,
    checkins: [
      ...(position.checkins || []),
      {
        list: Number(listId),
        type,
        datetime: datetime || new Date().toISOString(),
        device: null
      }
    ]
  }
  if (!next.listIds?.includes(Number(listId))) {
    next.listIds = [...new Set([...(next.listIds || []), Number(listId)])]
  }
  upsertPosition(index, next)
  return next
}

export function enqueuePendingRedeem(index, entry) {
  index.pendingRedeems = [...(index.pendingRedeems || []), entry]
}

export function enqueuePendingRegistration(index, entry) {
  index.pendingRegistrations = [...(index.pendingRegistrations || []), entry]
}

export async function flushPendingRedeems(
  index,
  { url, apitoken, organizer, correlationId = null }
) {
  const pending = [...(index.pendingRedeems || [])]
  if (!pending.length) {
    return { flushed: 0, remaining: [] }
  }

  const remaining = []
  let flushed = 0

  for (const item of pending) {
    const started = Date.now()
    const requestId = createOperationalId('redeem')
    try {
      const response = await fetch(
        `${String(url).replace(/\/+$/, '')}/api/v1/organizers/${organizer}/checkin/redeem/`,
        {
          method: 'POST',
          credentials: 'omit',
          headers: {
            Authorization: `Device ${apitoken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            secret: item.secret,
            source_type: 'barcode',
            lists: item.lists,
            type: item.type || 'entry',
            force: false,
            ignore_unpaid: false,
            nonce: item.nonce,
            datetime: item.datetime || null,
            questions_supported: false
          })
        }
      )
      let body = {}
      let parseFailed = false
      try {
        const parsed = await response.json()
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed
        } else {
          parseFailed = true
        }
      } catch {
        parseFailed = true
      }
      if (!parseFailed && response.ok && (body.status === 'ok' || body.status === 'redeemed')) {
        if (body.position) {
          const record = normalizePositionFromOrder(
            { code: body.position.order, status: body.position.order__status || 'p' },
            body.position
          )
          if (record) {
            upsertPosition(index, record)
          }
        }
        logApiResult({
          action: 'checkin.redeem',
          outcome: 'success',
          status: response.status,
          duration_ms: Date.now() - started,
          error_code: null,
          request_id: requestId,
          correlation_id: correlationId
        })
        flushed += 1
        continue
      }
      if (!parseFailed && body.status === 'error' && body.reason === 'already_redeemed') {
        logApiResult({
          action: 'checkin.redeem',
          outcome: 'success',
          status: response.status,
          duration_ms: Date.now() - started,
          error_code: null,
          request_id: requestId,
          correlation_id: correlationId
        })
        flushed += 1
        continue
      }
      const errorCode = parseFailed
        ? 'invalid_payload'
        : toSafeErrorCode(
            body.reason,
            SAFE_REDEEM_ERROR_CODES,
            response.ok ? 'redeem_failed' : 'http_error'
          )
      logApiResult({
        action: 'checkin.redeem',
        outcome: 'failure',
        status: response.status,
        duration_ms: Date.now() - started,
        error_code: errorCode,
        request_id: requestId,
        correlation_id: correlationId
      })
      if (response.status >= 500 || response.status === 0) {
        remaining.push(item)
        continue
      }
      remaining.push({ ...item, lastError: body.reason || `HTTP ${response.status}` })
    } catch {
      logApiResult({
        action: 'checkin.redeem',
        outcome: 'failure',
        status: null,
        duration_ms: Date.now() - started,
        error_code: 'request_error',
        request_id: requestId,
        correlation_id: correlationId
      })
      remaining.push(item)
    }
  }

  index.pendingRedeems = remaining
  return { flushed, remaining }
}

export async function flushPendingRegistrations(
  index,
  { url, apitoken, organizer, eventSlug, correlationId = null }
) {
  const pending = [...(index.pendingRegistrations || [])]
  if (!pending.length) {
    return { flushed: 0, remaining: [] }
  }

  const base = String(url).replace(/\/+$/, '')
  const remaining = []
  let flushed = 0

  for (const item of pending) {
    const started = Date.now()
    const requestId = createOperationalId('reg')
    try {
      const createResp = await fetch(
        `${base}/api/v1/organizers/${organizer}/events/${eventSlug}/orders/`,
        {
          method: 'POST',
          credentials: 'omit',
          headers: {
            Authorization: `Device ${apitoken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(item.payload)
        }
      )
      let created = {}
      let createParseFailed = false
      try {
        const parsedCreated = await createResp.json()
        if (parsedCreated && typeof parsedCreated === 'object' && !Array.isArray(parsedCreated)) {
          created = parsedCreated
        } else {
          createParseFailed = true
        }
      } catch {
        createParseFailed = true
      }
      if (!createResp.ok || createParseFailed) {
        logApiResult({
          action: 'checkin.register',
          outcome: 'failure',
          status: createResp.status,
          duration_ms: Date.now() - started,
          error_code: createParseFailed
            ? 'invalid_payload'
            : createResp.status >= 500
              ? 'http_error'
              : 'rejected',
          request_id: requestId,
          correlation_id: correlationId
        })
        if (createResp.status >= 500 || createParseFailed) {
          remaining.push(item)
        } else {
          remaining.push({ ...item, lastError: JSON.stringify(created) })
        }
        continue
      }

      let paid = created
      if (created.status !== 'p') {
        const paidResp = await fetch(
          `${base}/api/v1/organizers/${organizer}/events/${eventSlug}/orders/${created.code}/mark_paid/`,
          {
            method: 'POST',
            credentials: 'omit',
            headers: {
              Authorization: `Device ${apitoken}`,
              Accept: 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ send_email: false })
          }
        )
        let paidParseFailed = false
        try {
          const parsedPaid = await paidResp.json()
          if (parsedPaid && typeof parsedPaid === 'object' && !Array.isArray(parsedPaid)) {
            paid = parsedPaid
          } else {
            paid = {}
            paidParseFailed = true
          }
        } catch {
          paid = {}
          paidParseFailed = true
        }
        if (!paidResp.ok || paidParseFailed || paid.status !== 'p') {
          logApiResult({
            action: 'checkin.register',
            outcome: 'failure',
            status: paidResp.status,
            duration_ms: Date.now() - started,
            error_code: paidParseFailed ? 'invalid_payload' : 'mark_paid_failed',
            request_id: requestId,
            correlation_id: correlationId
          })
          remaining.push({ ...item, lastError: 'mark_paid_failed', createdCode: created.code })
          continue
        }
      }

      const position = paid.positions?.[0]
      if (position) {
        const record = normalizePositionFromOrder(paid, position)
        if (record) {
          upsertPosition(index, record)
        }
      }
      flushed += 1
      logApiResult({
        action: 'checkin.register',
        outcome: 'success',
        status: createResp.status,
        duration_ms: Date.now() - started,
        request_id: requestId,
        correlation_id: correlationId
      })
    } catch {
      logApiResult({
        action: 'checkin.register',
        outcome: 'failure',
        status: null,
        duration_ms: Date.now() - started,
        error_code: 'request_error',
        request_id: requestId,
        correlation_id: correlationId
      })
      remaining.push(item)
    }
  }

  index.pendingRegistrations = remaining
  return { flushed, remaining }
}

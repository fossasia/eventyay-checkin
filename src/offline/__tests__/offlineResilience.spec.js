import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptySnapshot, mergeOrdersIntoSnapshot, normalizePositionFromOrder } from '@/offline/normalize'
import { createMemoryIndex, positionToSearchOrder, searchPositions } from '@/offline/memoryIndex'
import {
  applyLocalCheckin,
  enqueuePendingRedeem,
  evaluateLocalRedeem,
  isBrowserOffline,
  MISSING_OFFLINE_DATA_MESSAGE
} from '@/offline/offlineActions'
import { canUseOfflineSync } from '@/offline/syncEngine'
import {
  clearSnapshotMemory,
  ensureDeviceSalt,
  loadEncryptedSnapshot,
  saveEncryptedSnapshot
} from '@/offline/snapshotStore'
import { decryptJson, deriveSnapshotKey, encryptJson } from '@/offline/snapshotCrypto'
import { memoryIndexToSnapshot } from '@/offline/memoryIndex'

describe('offline resilience', () => {
  afterEach(() => {
    clearSnapshotMemory()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('survives encrypt → persist → reload → decrypt without network', async () => {
    const salt = ensureDeviceSalt()
    const token = 'device-token-offline'
    const key = await deriveSnapshotKey(token, salt)

    const snapshot = createEmptySnapshot('org', 'evt')
    mergeOrdersIntoSnapshot(snapshot, [
      {
        code: 'ABC',
        status: 'p',
        positions: [
          {
            id: 11,
            secret: 'ticket-secret',
            product: 2,
            attendee_name: 'Ada Lovelace',
            attendee_email: 'ada@example.test',
            pdf_data: { attendee_name: 'Ada Lovelace', secret: 'ticket-secret' },
            checkins: []
          }
        ]
      }
    ])
    snapshot.products = [{ id: 2, name: 'General', admission: true, active: true }]
    snapshot.checkInLists = [{ id: 3, name: 'Gate A' }]
    snapshot.lastSyncedAt = '2030-01-01T00:00:00Z'

    const envelope = await encryptJson(snapshot, key)
    await saveEncryptedSnapshot('org', 'evt', envelope)

    // Simulate reload: clear memory, keep localStorage/cache envelope.
    clearSnapshotMemory()
    const loaded = await loadEncryptedSnapshot('org', 'evt')
    const restored = await decryptJson(loaded, await deriveSnapshotKey(token, salt))
    const index = createMemoryIndex(restored)

    expect(index.positionsBySecret.get('ticket-secret').attendeeName).toBe('Ada Lovelace')
    expect(index.products).toHaveLength(1)
    expect(index.checkInLists[0].id).toBe(3)

    const evaluation = evaluateLocalRedeem(index, 'ticket-secret', { listId: 3, type: 'entry' })
    expect(evaluation.ok).toBe(true)

    applyLocalCheckin(index, evaluation.position, { listId: 3, type: 'entry' })
    enqueuePendingRedeem(index, {
      secret: 'ticket-secret',
      lists: [3],
      type: 'entry',
      nonce: 'nonce-1',
      datetime: '2030-01-01T01:00:00Z'
    })
    expect(index.pendingRedeems).toHaveLength(1)
    expect(evaluateLocalRedeem(index, 'unknown', { listId: 3 }).message).toBe(
      MISSING_OFFLINE_DATA_MESSAGE
    )
  })

  it('maps offline search hits into check-in order rows', () => {
    const snapshot = createEmptySnapshot('org', 'evt')
    snapshot.positionsBySecret['sec'] = normalizePositionFromOrder(
      { code: 'Z', status: 'p' },
      {
        id: 1,
        secret: 'sec',
        product: 1,
        attendee_name: 'Grace Hopper',
        attendee_email: 'grace@example.test',
        pdf_data: { attendee_name: 'Grace Hopper' },
        checkins: []
      }
    )
    const index = createMemoryIndex(snapshot)
    const rows = searchPositions(index, 'hopper').map(positionToSearchOrder)
    expect(rows).toHaveLength(1)
    expect(rows[0].attendee_name).toBe('Grace Hopper')
    expect(rows[0].secret).toBe('sec')
    expect(rows[0].offline).toBe(true)
  })

  it('treats Badge Station as non-offline and Check-In Staff as offline-capable', () => {
    expect(canUseOfflineSync('CheckIn', 'eventyay_checkin')).toBe(true)
    expect(canUseOfflineSync('Badge Station', 'eventyay_checkin_online_kiosk')).toBe(false)
  })

  it('detects browser offline via navigator.onLine', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isBrowserOffline()).toBe(true)
    vi.stubGlobal('navigator', { onLine: true })
    expect(isBrowserOffline()).toBe(false)
  })

  it('round-trips pending queues through snapshot serialization', () => {
    const snapshot = createEmptySnapshot('org', 'evt')
    const index = createMemoryIndex(snapshot)
    index.pendingRedeems.push({ secret: 'a', nonce: 'n1', lists: [1], type: 'entry' })
    index.pendingRegistrations.push({ id: 'p1', payload: { email: 'x@y.z' } })
    const again = createMemoryIndex(memoryIndexToSnapshot(index))
    expect(again.pendingRedeems[0].nonce).toBe('n1')
    expect(again.pendingRegistrations[0].id).toBe('p1')
  })
})

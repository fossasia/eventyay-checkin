import { describe, expect, it } from 'vitest'
import { createEmptySnapshot } from '@/offline/normalize'
import { createMemoryIndex } from '@/offline/memoryIndex'
import {
  applyLocalCheckin,
  enqueuePendingRedeem,
  enqueuePendingRegistration,
  evaluateLocalRedeem,
  MISSING_OFFLINE_DATA_MESSAGE
} from '@/offline/offlineActions'

describe('offlineActions', () => {
  function indexWithAttendee() {
    const snapshot = createEmptySnapshot('org', 'evt')
    snapshot.positionsBySecret['sec-1'] = {
      id: 1,
      secret: 'sec-1',
      product: 9,
      orderStatus: 'p',
      attendeeName: 'Ada',
      attendeeEmail: 'ada@example.test',
      company: '',
      jobTitle: '',
      checkins: [],
      listIds: [3],
      pdfData: { attendee_name: 'Ada' },
      searchText: 'ada ada@example.test sec-1'
    }
    return createMemoryIndex(snapshot)
  }

  it('asks to reconnect when the secret is not in the snapshot', () => {
    const index = indexWithAttendee()
    const result = evaluateLocalRedeem(index, 'unknown', { listId: 3, type: 'entry' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing')
    expect(result.message).toBe(MISSING_OFFLINE_DATA_MESSAGE)
  })

  it('rejects revoked secrets', () => {
    const index = indexWithAttendee()
    index.revokedSecrets.add('sec-1')
    const result = evaluateLocalRedeem(index, 'sec-1', { listId: 3 })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('revoked')
  })

  it('queues a local check-in with a stable nonce entry', () => {
    const index = indexWithAttendee()
    const evaluation = evaluateLocalRedeem(index, 'sec-1', { listId: 3, type: 'entry' })
    expect(evaluation.ok).toBe(true)
    applyLocalCheckin(index, evaluation.position, { listId: 3, type: 'entry' })
    enqueuePendingRedeem(index, {
      secret: 'sec-1',
      lists: [3],
      type: 'entry',
      nonce: 'abc123',
      datetime: '2030-01-01T00:00:00Z'
    })
    expect(index.pendingRedeems).toHaveLength(1)
    expect(index.positionsBySecret.get('sec-1').checkins).toHaveLength(1)

    const second = evaluateLocalRedeem(index, 'sec-1', { listId: 3, type: 'entry' })
    expect(second.alreadyRedeemed).toBe(true)
  })

  it('queues live registrations without inventing a ticket secret', () => {
    const index = indexWithAttendee()
    enqueuePendingRegistration(index, {
      id: 'pending-1',
      payload: { email: 'new@example.test' },
      createdAt: '2030-01-01T00:00:00Z'
    })
    expect(index.pendingRegistrations).toHaveLength(1)
    expect(index.pendingRegistrations[0].payload.email).toBe('new@example.test')
  })
})

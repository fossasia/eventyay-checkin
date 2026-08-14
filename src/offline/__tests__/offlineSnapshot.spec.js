import { afterEach, describe, expect, it } from 'vitest'
import { decryptJson, deriveSnapshotKey, encryptJson, createDeviceSalt } from '@/offline/snapshotCrypto'
import {
  createEmptySnapshot,
  mergeLayoutsIntoSnapshot,
  mergeOrdersIntoSnapshot,
  mergeRevokedIntoSnapshot,
  normalizePositionFromOrder
} from '@/offline/normalize'
import {
  createMemoryIndex,
  listStoredPositions,
  lookupBySecret,
  memoryIndexToSnapshot,
  searchPositions
} from '@/offline/memoryIndex'
import { canUseOfflineSync } from '@/offline/syncEngine'
import { clearSnapshotMemory, ensureDeviceSalt, saveEncryptedSnapshot, loadEncryptedSnapshot } from '@/offline/snapshotStore'

describe('snapshotCrypto', () => {
  it('round-trips JSON through AES-GCM', async () => {
    const salt = createDeviceSalt()
    const key = await deriveSnapshotKey('device-token-abc', salt)
    const payload = { hello: 'world', n: 42 }
    const envelope = await encryptJson(payload, key)
    expect(envelope.iv).toBeTruthy()
    expect(envelope.data).toBeTruthy()
    await expect(decryptJson(envelope, key)).resolves.toEqual(payload)
  })

  it('fails decryption with the wrong token', async () => {
    const salt = createDeviceSalt()
    const key = await deriveSnapshotKey('token-a', salt)
    const envelope = await encryptJson({ secret: 'x' }, key)
    const otherKey = await deriveSnapshotKey('token-b', salt)
    await expect(decryptJson(envelope, otherKey)).rejects.toBeTruthy()
  })
})

describe('normalize + memory index', () => {
  it('keeps custom pdf_data fields without a fixed schema', () => {
    const record = normalizePositionFromOrder(
      { code: 'ABC', status: 'p' },
      {
        id: 1,
        secret: 'sec-1',
        product: 9,
        attendee_name: 'Ada',
        pdf_data: {
          attendee_name: 'Ada',
          'question_42': 'Vegan',
          images: { photo: '/api/v1/pdf_image/photo' }
        },
        checkins: [{ list: 3, type: 'entry', datetime: '2030-01-01T00:00:00Z' }]
      }
    )
    expect(record.pdfData.question_42).toBe('Vegan')
    expect(record.pdfData.images).toBeUndefined()
    expect(record.listIds).toEqual([3])
    expect(record.searchText).toContain('ada')
  })

  it('merges orders, layouts, and revoked secrets into lookup maps', () => {
    const snapshot = createEmptySnapshot('org', 'evt')
    mergeLayoutsIntoSnapshot(snapshot, [
      {
        id: 7,
        name: 'Default',
        default: true,
        layout: '[{"type":"textarea","content":"attendee_name"}]',
        product_assignments: [{ product: 9 }]
      }
    ])
    mergeOrdersIntoSnapshot(snapshot, [
      {
        code: 'ABC',
        status: 'p',
        positions: [
          {
            id: 1,
            secret: 'sec-1',
            product: 9,
            attendee_name: 'Ada Lovelace',
            attendee_email: 'ada@example.test',
            pdf_data: { attendee_name: 'Ada Lovelace' },
            checkins: []
          }
        ]
      }
    ])
    mergeRevokedIntoSnapshot(snapshot, [{ secret: 'revoked-1' }])

    const index = createMemoryIndex(snapshot)
    expect(lookupBySecret(index, 'sec-1').status).toBe('found')
    expect(lookupBySecret(index, 'revoked-1').status).toBe('revoked')
    expect(lookupBySecret(index, 'unknown').status).toBe('missing')
    expect(searchPositions(index, 'lovelace')).toHaveLength(1)
    expect(listStoredPositions(index, '')).toHaveLength(1)
    expect(listStoredPositions(index, 'ada')).toHaveLength(1)
    expect(listStoredPositions(index, 'zzz')).toHaveLength(0)
    expect(index.layouts.get('7').layout[0].content).toBe('attendee_name')

    const roundTrip = createMemoryIndex(memoryIndexToSnapshot(index))
    expect(roundTrip.positionsBySecret.get('sec-1').attendeeName).toBe('Ada Lovelace')
  })

  it('keeps previously synced badge background PDFs when layouts refresh', () => {
    const snapshot = createEmptySnapshot('org', 'evt')
    mergeLayoutsIntoSnapshot(snapshot, [
      {
        id: 7,
        name: 'Default',
        default: true,
        layout: '[]',
        backgroundPdf: 'JVBERi0x'
      }
    ])
    mergeLayoutsIntoSnapshot(snapshot, [
      {
        id: 7,
        name: 'Default',
        default: true,
        layout: '[]',
        background: '/media/pub/bg.pdf'
      }
    ])
    expect(snapshot.layouts['7'].backgroundPdf).toBe('JVBERi0x')
    expect(snapshot.layouts['7'].background).toBe('/media/pub/bg.pdf')
  })
})

describe('canUseOfflineSync', () => {
  it('allows Check-In Staff and blocks Badge Station / NoSync kiosk', () => {
    expect(canUseOfflineSync('CheckIn', 'eventyay_checkin')).toBe(true)
    expect(canUseOfflineSync('Badge Station', 'eventyay_checkin')).toBe(false)
    expect(canUseOfflineSync('CheckIn', 'eventyay_checkin_online_kiosk')).toBe(false)
    expect(canUseOfflineSync('CheckIn', 'full')).toBe(true)
  })
})

describe('snapshotStore', () => {
  afterEach(() => {
    clearSnapshotMemory()
    localStorage.clear()
  })

  it('persists and loads encrypted envelopes', async () => {
    ensureDeviceSalt()
    const envelope = { v: 1, iv: 'abc', data: 'def' }
    await saveEncryptedSnapshot('org', 'evt', envelope)
    await expect(loadEncryptedSnapshot('org', 'evt')).resolves.toEqual(envelope)
  })
})

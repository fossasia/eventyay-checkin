import { decryptJson, deriveSnapshotKey, encryptJson } from '@/offline/snapshotCrypto'
import {
  clearSnapshotMemory,
  ensureDeviceSalt,
  loadEncryptedSnapshot,
  saveEncryptedSnapshot
} from '@/offline/snapshotStore'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  clearSnapshotMemory()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('snapshot storage fallback', () => {
  const envelope = { v: 1, iv: 'iv', data: 'encrypted' }

  it('keeps the in-memory snapshot decryptable when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const key = await deriveSnapshotKey('device-token', ensureDeviceSalt())
    await saveEncryptedSnapshot(
      'org',
      'event',
      await encryptJson({ pendingRedeems: ['ticket'] }, key)
    )
    const loaded = await loadEncryptedSnapshot('org', 'event')
    await expect(
      decryptJson(loaded, await deriveSnapshotKey('device-token', ensureDeviceSalt()))
    ).resolves.toEqual({ pendingRedeems: ['ticket'] })
  })

  it('persists to localStorage when CacheStorage rejects a write', async () => {
    const cache = {
      put: vi.fn().mockRejectedValue(new Error('quota')),
      match: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
    await saveEncryptedSnapshot('org', 'event', envelope)
    clearSnapshotMemory()
    await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(envelope)
    expect(cache.put).toHaveBeenCalledOnce()
  })

  it.each(['read', 'json'])(
    'loads the localStorage fallback even when the cache cannot %s',
    async (failure) => {
      localStorage.setItem('snapshot:org:event', JSON.stringify(envelope))
      const match =
        failure === 'read'
          ? vi.fn().mockRejectedValue(new Error('cache unavailable'))
          : vi
              .fn()
              .mockResolvedValue({ json: vi.fn().mockRejectedValue(new Error('bad envelope')) })
      vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match }) })
      await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(envelope)
    }
  )
  it('prefers the new fallback over an older cache entry after a failed write', async () => {
    const cache = {
      put: vi.fn().mockRejectedValue(new Error('quota')),
      match: vi.fn().mockResolvedValue({ json: async () => ({ v: 1, iv: 'old', data: 'old' }) })
    }
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
    await saveEncryptedSnapshot('org', 'event', envelope)
    clearSnapshotMemory()
    await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(envelope)
  })

  it('removes an older fallback after a successful cache write', async () => {
    localStorage.setItem('snapshot:org:event', JSON.stringify({ v: 1, iv: 'old', data: 'old' }))
    const cache = {
      put: vi.fn().mockResolvedValue(undefined),
      match: vi.fn().mockResolvedValue({ json: async () => envelope })
    }
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
    await saveEncryptedSnapshot('org', 'event', envelope)
    clearSnapshotMemory()
    expect(localStorage.getItem('snapshot:org:event')).toBeNull()
    await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(envelope)
  })

  it('keeps the persisted salt if storage access later fails in the same session', () => {
    localStorage.setItem('eventyay-offline-salt', 'persisted-salt')
    expect(ensureDeviceSalt()).toBe('persisted-salt')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(ensureDeviceSalt()).toBe('persisted-salt')
  })
  it.each(['read', 'json'])(
    'returns no snapshot after a cache %s failure with no fallback',
    async (failure) => {
      const match =
        failure === 'read'
          ? vi.fn().mockRejectedValue(new Error('cache unavailable'))
          : vi
              .fn()
              .mockResolvedValue({ json: vi.fn().mockRejectedValue(new Error('bad envelope')) })
      vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match }) })
      await expect(loadEncryptedSnapshot('org', 'event')).resolves.toBeNull()
      expect(match).toHaveBeenCalledOnce()
    }
  )

  it('loads a valid cache entry when localStorage contains malformed JSON', async () => {
    localStorage.setItem('snapshot:org:event', '{bad')
    vi.stubGlobal('caches', {
      open: vi
        .fn()
        .mockResolvedValue({ match: vi.fn().mockResolvedValue({ json: async () => envelope }) })
    })
    await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(envelope)
  })
})

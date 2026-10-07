import { decryptJson, deriveSnapshotKey, encryptJson } from '@/offline/snapshotCrypto'
import {
  clearSnapshotMemory,
  ensureDeviceSalt,
  loadEncryptedSnapshot,
  saveEncryptedSnapshot
} from '@/offline/snapshotStore'
import { flushPromises } from '@vue/test-utils'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.stubGlobal('Blob', NodeBlob))

function statefulCache() {
  const records = new Map()
  return {
    put: vi.fn(async (request, response) => {
      records.set(request.url, response.clone())
    }),
    match: vi.fn(async (request) => records.get(request.url)?.clone())
  }
}

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
    const cache = statefulCache()
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
  it('keeps the established salt when previously blocked storage becomes readable', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const salt = ensureDeviceSalt()
    const encrypted = await encryptJson(
      { pendingRedeems: ['ticket'] },
      await deriveSnapshotKey('token', salt)
    )
    await saveEncryptedSnapshot('org', 'event', encrypted)
    get.mockRestore()
    set.mockRestore()
    localStorage.setItem('eventyay-offline-salt', 'another-persisted-salt')
    const loaded = await loadEncryptedSnapshot('org', 'event')
    await expect(
      decryptJson(loaded, await deriveSnapshotKey('token', ensureDeviceSalt()))
    ).resolves.toEqual({ pendingRedeems: ['ticket'] })
  })

  it('keeps snapshots in memory when their salt cannot be persisted', async () => {
    const cache = statefulCache()
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const salt = ensureDeviceSalt()
    const encrypted = await encryptJson(
      { pendingRedeems: ['ticket'] },
      await deriveSnapshotKey('token', salt)
    )
    await saveEncryptedSnapshot('org', 'event', encrypted)
    await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(encrypted)
    expect(cache.put).not.toHaveBeenCalled()
    clearSnapshotMemory()
    await expect(loadEncryptedSnapshot('org', 'event')).resolves.toBeNull()
  })

  it('prefers the cache over an older legacy localStorage copy', async () => {
    localStorage.setItem('snapshot:org:event', JSON.stringify({ v: 1, iv: 'old', data: 'old' }))
    const cache = statefulCache()
    await cache.put(
      new Request('https://offline.eventyay.local/snapshot:org:event'),
      new Response(JSON.stringify(envelope))
    )
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
    await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(envelope)
  })

  it.each(['cache', 'fallback'])(
    'preserves the latest of overlapping saves using %s storage',
    async (backend) => {
      const cache = statefulCache()
      const put = cache.put.getMockImplementation()
      let releaseOld
      const oldWrite = new Promise((resolve) => {
        releaseOld = resolve
      })
      let writes = 0
      cache.put.mockImplementation(async (...args) => {
        if (++writes === 1) await oldWrite
        if (backend === 'fallback') throw new Error('quota')
        await put(...args)
      })
      vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
      const first = saveEncryptedSnapshot('org', 'event', { v: 1, iv: 'old', data: 'old' })
      const second = saveEncryptedSnapshot('org', 'event', envelope)
      await flushPromises()
      releaseOld()
      await Promise.all([first, second])
      clearSnapshotMemory()
      await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(envelope)
    }
  )
  it('loads the newer cache entry when fallback cleanup and writes both fail', async () => {
    localStorage.setItem(
      'snapshot:org:event',
      JSON.stringify({ envelope: { v: 1, iv: 'old', data: 'old' }, writtenAt: 1 })
    )
    const cache = statefulCache()
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked cleanup')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await saveEncryptedSnapshot('org', 'event', envelope)
    clearSnapshotMemory()
    await expect(loadEncryptedSnapshot('org', 'event')).resolves.toEqual(envelope)
  })
})

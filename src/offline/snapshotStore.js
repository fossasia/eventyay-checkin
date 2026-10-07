import { createDeviceSalt } from '@/offline/snapshotCrypto'

const CACHE_NAME = 'eventyay-offline-snapshots-v1'
const SALT_KEY = 'eventyay-offline-salt'
const memoryBlobs = new Map()
let sessionSalt = null

function snapshotKey(organizer, eventSlug) {
  return `snapshot:${organizer}:${eventSlug}`
}

export function ensureDeviceSalt() {
  try {
    const existing = localStorage.getItem(SALT_KEY)
    if (existing) {
      sessionSalt = existing
      return existing
    }
  } catch {
    // fall through
  }
  const salt = sessionSalt || createDeviceSalt()
  sessionSalt = salt
  try {
    localStorage.setItem(SALT_KEY, salt)
  } catch {
    // Keep the same salt in memory when persistent storage is unavailable.
  }
  return salt
}

async function openCache() {
  if (typeof caches === 'undefined') {
    return null
  }
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

export async function saveEncryptedSnapshot(organizer, eventSlug, envelope) {
  const key = snapshotKey(organizer, eventSlug)
  memoryBlobs.set(key, envelope)
  const cache = await openCache()
  if (cache) {
    try {
      const body = new Blob([JSON.stringify(envelope)], { type: 'application/json' })
      await cache.put(new Request(`https://offline.eventyay.local/${key}`), new Response(body))
      localStorage.removeItem(key)
      return
    } catch {
      // Try localStorage when CacheStorage is full or unavailable.
    }
  }
  try {
    localStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    // Memory-only fallback already set.
  }
}

export async function loadEncryptedSnapshot(organizer, eventSlug) {
  const key = snapshotKey(organizer, eventSlug)
  if (memoryBlobs.has(key)) {
    return memoryBlobs.get(key)
  }
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const envelope = JSON.parse(raw)
      memoryBlobs.set(key, envelope)
      return envelope
    }
  } catch {
    // ignore
  }
  const cache = await openCache()
  if (cache) {
    try {
      const match = await cache.match(new Request(`https://offline.eventyay.local/${key}`))
      if (match) {
        const envelope = await match.json()
        memoryBlobs.set(key, envelope)
        return envelope
      }
    } catch {
      // The cache is unavailable; no persisted fallback was found.
    }
  }
  return null
}

export async function deleteEncryptedSnapshot(organizer, eventSlug) {
  const key = snapshotKey(organizer, eventSlug)
  memoryBlobs.delete(key)
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
  const cache = await openCache()
  if (cache) {
    await cache.delete(new Request(`https://offline.eventyay.local/${key}`))
  }
}

export async function wipeAllEncryptedSnapshots() {
  memoryBlobs.clear()
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith('snapshot:')) {
        keys.push(key)
      }
    }
    keys.forEach((key) => localStorage.removeItem(key))
  } catch {
    // ignore
  }
  if (typeof caches !== 'undefined') {
    try {
      await caches.delete(CACHE_NAME)
    } catch {
      // ignore
    }
  }
}

/** Test helper: clear snapshot and salt memory between specs. */
export function clearSnapshotMemory() {
  sessionSalt = null
  memoryBlobs.clear()
}

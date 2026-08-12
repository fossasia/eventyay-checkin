import { createDeviceSalt } from '@/offline/snapshotCrypto'

const CACHE_NAME = 'eventyay-offline-snapshots-v1'
const SALT_KEY = 'eventyay-offline-salt'
const memoryBlobs = new Map()

function snapshotKey(organizer, eventSlug) {
  return `snapshot:${organizer}:${eventSlug}`
}

export function ensureDeviceSalt() {
  try {
    const existing = localStorage.getItem(SALT_KEY)
    if (existing) {
      return existing
    }
  } catch {
    // fall through
  }
  const salt = createDeviceSalt()
  try {
    localStorage.setItem(SALT_KEY, salt)
  } catch {
    // Keep salt for this session via return value only if storage fails.
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
  if (!cache) {
    try {
      localStorage.setItem(key, JSON.stringify(envelope))
    } catch {
      // Memory-only fallback already set.
    }
    return
  }
  const body = new Blob([JSON.stringify(envelope)], { type: 'application/json' })
  await cache.put(new Request(`https://offline.eventyay.local/${key}`), new Response(body))
}

export async function loadEncryptedSnapshot(organizer, eventSlug) {
  const key = snapshotKey(organizer, eventSlug)
  if (memoryBlobs.has(key)) {
    return memoryBlobs.get(key)
  }
  const cache = await openCache()
  if (cache) {
    const match = await cache.match(new Request(`https://offline.eventyay.local/${key}`))
    if (match) {
      const envelope = await match.json()
      memoryBlobs.set(key, envelope)
      return envelope
    }
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

/** Test helper: clear in-memory blob map between specs. */
export function clearSnapshotMemory() {
  memoryBlobs.clear()
}

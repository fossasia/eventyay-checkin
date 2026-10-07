import { createDeviceSalt } from '@/offline/snapshotCrypto'

const CACHE_NAME = 'eventyay-offline-snapshots-v1'
const SALT_KEY = 'eventyay-offline-salt'
const memoryBlobs = new Map()
let sessionSalt = null
let saltPersisted = false
const pendingSaves = new Map()

function snapshotKey(organizer, eventSlug) {
  return `snapshot:${organizer}:${eventSlug}`
}

export function ensureDeviceSalt() {
  if (sessionSalt) {
    return sessionSalt
  }
  try {
    const existing = localStorage.getItem(SALT_KEY)
    if (existing) {
      sessionSalt = existing
      saltPersisted = true
      return existing
    }
  } catch {
    // fall through
  }
  sessionSalt = createDeviceSalt()
  try {
    localStorage.setItem(SALT_KEY, sessionSalt)
    saltPersisted = true
  } catch {
    // Snapshots using this salt must stay in memory for this session.
  }
  return sessionSalt
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
  if (sessionSalt && !saltPersisted) {
    return
  }

  const previous = pendingSaves.get(key) || Promise.resolve()
  const save = previous
    .catch(() => {})
    .then(async () => {
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
        // Distinguish a new fallback from legacy copies that may predate the cache.
        localStorage.setItem(key, JSON.stringify({ envelope }))
      } catch {
        // Memory-only fallback already set.
      }
    })
  pendingSaves.set(key, save)
  try {
    await save
  } finally {
    if (pendingSaves.get(key) === save) {
      pendingSaves.delete(key)
    }
  }
}

export async function loadEncryptedSnapshot(organizer, eventSlug) {
  const key = snapshotKey(organizer, eventSlug)
  if (memoryBlobs.has(key)) {
    return memoryBlobs.get(key)
  }
  let fallback = null
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      fallback = JSON.parse(raw)
      if (fallback?.envelope) {
        memoryBlobs.set(key, fallback.envelope)
        return fallback.envelope
      }
    }
  } catch {
    // Continue with CacheStorage when localStorage is unavailable or malformed.
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
      // Continue with the legacy localStorage fallback.
    }
  }
  if (fallback) {
    memoryBlobs.set(key, fallback)
  }
  return fallback
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
  saltPersisted = false
  memoryBlobs.clear()
}

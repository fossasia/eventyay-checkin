import { createDeviceSalt } from '@/offline/snapshotCrypto'

const CACHE_NAME = 'eventyay-offline-snapshots-v1'
const SALT_KEY = 'eventyay-offline-salt'
const memoryBlobs = new Map()
let sessionSalt = null
let saltPersisted = false
let lastWriteTime = 0
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
  lastWriteTime = Math.max(Date.now(), lastWriteTime + 1)
  const record = { envelope, writtenAt: lastWriteTime }
  const previous = pendingSaves.get(key) || Promise.resolve()
  const save = previous
    .catch(() => {})
    .then(async () => {
      const cache = await openCache()
      let cached = false
      if (cache) {
        try {
          const body = new Blob([JSON.stringify(record)], { type: 'application/json' })
          await cache.put(new Request(`https://offline.eventyay.local/${key}`), new Response(body))
          cached = true
        } catch {
          // Try localStorage when CacheStorage is full or unavailable.
        }
      }
      if (cached) {
        try {
          localStorage.removeItem(key)
        } catch {
          // The cached record remains newer than any fallback left behind.
        }
        return
      }
      try {
        localStorage.setItem(key, JSON.stringify(record))
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

function snapshotRecord(value) {
  const record = value?.envelope ? value : { envelope: value, writtenAt: 0 }
  if (!record.envelope?.iv || !record.envelope?.data) {
    return null
  }
  return record
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
      fallback = snapshotRecord(JSON.parse(raw))
    }
  } catch {
    // Continue with CacheStorage when localStorage is unavailable or malformed.
  }
  let cached = null
  const cache = await openCache()
  if (cache) {
    try {
      const match = await cache.match(new Request(`https://offline.eventyay.local/${key}`))
      if (match) {
        cached = snapshotRecord(await match.json())
      }
    } catch {
      // Continue with the localStorage fallback.
    }
  }
  const record =
    cached && (!fallback || (cached.writtenAt || 0) >= (fallback.writtenAt || 0))
      ? cached
      : fallback
  if (!record) {
    return null
  }
  lastWriteTime = Math.max(lastWriteTime, record.writtenAt || 0)
  memoryBlobs.set(key, record.envelope)
  return record.envelope
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
  lastWriteTime = 0
  memoryBlobs.clear()
}

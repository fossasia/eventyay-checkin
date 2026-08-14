import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  lookupBySecret,
  listStoredPositions,
  positionToSearchOrder,
  searchPositions
} from '@/offline/memoryIndex'
import {
  canUseOfflineSync,
  loadOfflineIndex,
  runOfflineSync,
  wipeOfflineData
} from '@/offline/syncEngine'

export const useOfflineSyncStore = defineStore('offlineSync', () => {
  const index = ref(null)
  const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const isSyncing = ref(false)
  const lastError = ref('')
  const lastSyncedAt = ref(null)
  const lastCounts = ref(null)
  const enabled = ref(false)
  let autoSyncTimer = null

  const pendingCount = computed(() => {
    if (!index.value) {
      return 0
    }
    return (index.value.pendingRedeems?.length || 0) + (index.value.pendingRegistrations?.length || 0)
  })

  const hasSnapshotData = computed(() => Boolean(index.value?.positionsBySecret?.size))

  const statusLabel = computed(() => {
    if (!enabled.value) {
      return ''
    }
    if (isSyncing.value) {
      return 'Syncing…'
    }
    if (!isOnline.value) {
      return pendingCount.value ? `Offline · ${pendingCount.value} pending` : 'Offline'
    }
    if (lastSyncedAt.value) {
      return 'Synced'
    }
    return 'Online'
  })

  function setOnline(value) {
    isOnline.value = Boolean(value)
  }

  function isOfflineCapable(processApi) {
    return (
      Boolean(processApi?.apitoken) &&
      canUseOfflineSync(processApi.selectedRole, processApi.securityProfile)
    )
  }

  function isOfflineMode() {
    return !isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)
  }

  function clearAutoSyncTimer() {
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer)
      autoSyncTimer = null
    }
  }

  function scheduleAutoSync(processApi, { delayMs = 400 } = {}) {
    if (!isOfflineCapable(processApi) || !processApi?.apitoken) {
      return
    }
    if (!isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return
    }
    clearAutoSyncTimer()
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = null
      if (isSyncing.value) {
        return
      }
      syncNow(processApi).catch(() => {
        // Errors surface via status label.
      })
    }, delayMs)
  }

  async function hydrate(processApi) {
    enabled.value = isOfflineCapable(processApi)
    if (!enabled.value || !processApi.organizer || !processApi.eventSlug) {
      index.value = null
      return { ok: false }
    }
    try {
      index.value = await loadOfflineIndex({
        organizer: processApi.organizer,
        eventSlug: processApi.eventSlug,
        apitoken: processApi.apitoken
      })
      lastSyncedAt.value = index.value.lastSyncedAt
      return { ok: true, index: index.value }
    } catch {
      index.value = null
      lastError.value = 'Could not load offline snapshot'
      return { ok: false, error: lastError.value }
    }
  }

  async function syncNow(processApi) {
    if (!processApi?.apitoken) {
      return { ok: false, error: 'missing_credentials' }
    }
    if (!canUseOfflineSync(processApi.selectedRole, processApi.securityProfile)) {
      enabled.value = false
      return { ok: false, skipped: true, reason: 'profile_no_sync' }
    }
    enabled.value = true
    isSyncing.value = true
    lastError.value = ''
    try {
      const result = await runOfflineSync({
        url: processApi.url,
        apitoken: processApi.apitoken,
        organizer: processApi.organizer,
        eventSlug: processApi.eventSlug,
        selectedRole: processApi.selectedRole,
        securityProfile: processApi.securityProfile
      })
      if (result.ok) {
        index.value = result.index
        lastSyncedAt.value = result.index.lastSyncedAt
        lastCounts.value = result.counts
      } else if (result.error) {
        lastError.value = result.error
      }
      return result
    } catch (error) {
      lastError.value = error?.message || 'sync_failed'
      return { ok: false, error: lastError.value }
    } finally {
      isSyncing.value = false
    }
  }

  function findBySecret(secret) {
    if (!index.value) {
      return { status: 'missing' }
    }
    return lookupBySecret(index.value, secret)
  }

  function search(query) {
    if (!index.value) {
      return []
    }
    return searchPositions(index.value, query).map(positionToSearchOrder)
  }

  function searchStored(query = '', { limit = 100 } = {}) {
    if (!index.value) {
      return []
    }
    return listStoredPositions(index.value, query, { limit }).map(positionToSearchOrder)
  }

  async function wipe() {
    clearAutoSyncTimer()
    await wipeOfflineData()
    index.value = null
    lastSyncedAt.value = null
    lastCounts.value = null
    lastError.value = ''
    enabled.value = false
  }

  return {
    index,
    isOnline,
    isSyncing,
    lastError,
    lastSyncedAt,
    lastCounts,
    enabled,
    pendingCount,
    hasSnapshotData,
    statusLabel,
    setOnline,
    isOfflineCapable,
    isOfflineMode,
    hydrate,
    scheduleAutoSync,
    syncNow,
    findBySecret,
    search,
    searchStored,
    wipe
  }
})

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { lookupBySecret, searchPositions } from '@/offline/memoryIndex'
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

  const pendingCount = computed(() => {
    if (!index.value) {
      return 0
    }
    return (index.value.pendingRedeems?.length || 0) + (index.value.pendingRegistrations?.length || 0)
  })

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
      return `Synced`
    }
    return 'Online · not synced'
  })

  function setOnline(value) {
    isOnline.value = Boolean(value)
  }

  async function hydrate(processApi) {
    enabled.value =
      Boolean(processApi?.apitoken) &&
      canUseOfflineSync(processApi.selectedRole, processApi.securityProfile)
    if (!enabled.value || !processApi.organizer || !processApi.eventSlug) {
      index.value = null
      return
    }
    try {
      index.value = await loadOfflineIndex({
        organizer: processApi.organizer,
        eventSlug: processApi.eventSlug,
        apitoken: processApi.apitoken
      })
      lastSyncedAt.value = index.value.lastSyncedAt
    } catch {
      index.value = null
      lastError.value = 'Could not load offline snapshot'
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
    return searchPositions(index.value, query)
  }

  async function wipe() {
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
    statusLabel,
    setOnline,
    hydrate,
    syncNow,
    findBySecret,
    search,
    wipe
  }
})

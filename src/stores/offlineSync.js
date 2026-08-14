import { mergeProgressFloor, phaseLabel } from '@/offline/syncProgress'
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
import { setPendingPrintSync } from '@/offline/badgePrintAssets'

export const useOfflineSyncStore = defineStore('offlineSync', () => {
  const DISPLAY_TICK_MS = 50
  const DISPLAY_CATCHUP_RATIO = 0.28
  const index = ref(null)
  const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const isSyncing = ref(false)
  const lastError = ref('')
  const lastSyncedAt = ref(null)
  const lastCounts = ref(null)
  const enabled = ref(false)
  let autoSyncTimer = null

  /** Authoritative target from the sync engine (never decreases during a run). */
  const syncProgressTarget = ref(0)
  /** Smoothed value shown in the navbar (eases toward target). */
  const syncProgressPercent = ref(0)
  const syncPhase = ref('')
  let displayTimer = null
  let hideProgressTimer = null

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
      const phase = syncPhase.value ? phaseLabel(syncPhase.value) : 'Syncing'
      return `${phase} ${Math.round(syncProgressPercent.value)}%`
    }
    if (!isOnline.value) {
      return pendingCount.value ? `Offline · ${pendingCount.value} pending` : 'Offline'
    }
    if (lastSyncedAt.value) {
      return 'Synced'
    }
    return 'Online'
  })

  function clearDisplayTimer() {
    if (displayTimer) {
      clearInterval(displayTimer)
      displayTimer = null
    }
  }

  function clearHideProgressTimer() {
    if (hideProgressTimer) {
      clearTimeout(hideProgressTimer)
      hideProgressTimer = null
    }
  }

  function tickDisplayProgress() {
    const target = syncProgressTarget.value
    const current = syncProgressPercent.value
    if (current >= target) {
      syncProgressPercent.value = target
      if (target >= 100 || !isSyncing.value) {
        clearDisplayTimer()
      }
      return
    }
    const delta = target - current
    // Ease toward the target so the bar advances linearly without jumping.
    const step = Math.max(0.35, delta * DISPLAY_CATCHUP_RATIO)
    syncProgressPercent.value = Math.min(target, current + step)
  }

  function startDisplaySmoothing() {
    clearDisplayTimer()
    displayTimer = setInterval(tickDisplayProgress, DISPLAY_TICK_MS)
  }

  function setSyncProgress(update = {}) {
    if (update.phase) {
      syncPhase.value = update.phase
    }
    if (typeof update.percent === 'number') {
      syncProgressTarget.value = mergeProgressFloor(syncProgressTarget.value, update.percent)
    }
  }

  function resetSyncProgress() {
    clearHideProgressTimer()
    syncProgressTarget.value = 0
    syncProgressPercent.value = 0
    syncPhase.value = ''
  }

  function finishSyncProgress({ ok }) {
    syncProgressTarget.value = 100
    syncProgressPercent.value = Math.max(syncProgressPercent.value, ok ? 96 : syncProgressPercent.value)
    tickDisplayProgress()
    clearHideProgressTimer()
    hideProgressTimer = setTimeout(() => {
      if (!isSyncing.value) {
        resetSyncProgress()
      }
    }, ok ? 900 : 1600)
  }

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
    clearHideProgressTimer()
    resetSyncProgress()
    setSyncProgress({ phase: 'layouts', percent: 1 })
    startDisplaySmoothing()
    try {
      setPendingPrintSync({
        url: processApi.url,
        apitoken: processApi.apitoken,
        organizer: processApi.organizer,
        eventSlug: processApi.eventSlug
      })
      const result = await runOfflineSync({
        url: processApi.url,
        apitoken: processApi.apitoken,
        organizer: processApi.organizer,
        eventSlug: processApi.eventSlug,
        selectedRole: processApi.selectedRole,
        securityProfile: processApi.securityProfile,
        onProgress: setSyncProgress
      })
      if (result.ok) {
        index.value = result.index
        lastSyncedAt.value = result.index.lastSyncedAt
        lastCounts.value = result.counts
        finishSyncProgress({ ok: true })
      } else if (result.error) {
        lastError.value = result.error
        finishSyncProgress({ ok: false })
      } else {
        finishSyncProgress({ ok: false })
      }
      return result
    } catch (error) {
      lastError.value = error?.message || 'sync_failed'
      finishSyncProgress({ ok: false })
      return { ok: false, error: lastError.value }
    } finally {
      isSyncing.value = false
      clearDisplayTimer()
      // Snap display to the target so we do not leave a lagging percentage visible.
      syncProgressPercent.value = syncProgressTarget.value
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
    clearDisplayTimer()
    clearHideProgressTimer()
    await wipeOfflineData()
    index.value = null
    lastSyncedAt.value = null
    lastCounts.value = null
    lastError.value = ''
    enabled.value = false
    resetSyncProgress()
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
    syncProgressPercent,
    syncProgressTarget,
    syncPhase,
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

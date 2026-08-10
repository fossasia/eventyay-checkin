<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import NavBar from '@/components/NavBar.vue'
import NotificationHolder from '@/components/Notifications/NotificationHolder.vue'
import LoadingView from '@/components/Utilities/LoadingView.vue'
import { useLoadingStore } from '@/stores/loading'
import { useEventyayApi } from '@/stores/eventyayapi'
import { isKioskEnvironment } from '@/utils/kioskLauncher'
import { validateDeviceSession } from '@/utils/session'

const route = useRoute()
const loadingStore = useLoadingStore()
const processApi = useEventyayApi()
const isKioskShell = computed(() => isKioskEnvironment(route))

const SESSION_POLL_MS = 45000
let sessionPollTimer = null

function ensureNavbarLoadedForKiosk() {
  if (isKioskShell.value) {
    loadingStore.navbarLoaded()
  }
}

async function pollDeviceSession() {
  if (!processApi.apitoken) {
    return
  }
  const isValid = await validateDeviceSession(processApi)
  if (!isValid) {
    processApi.handleAuthError()
  }
}

function startSessionPolling() {
  stopSessionPolling()
  if (!processApi.apitoken) {
    return
  }
  pollDeviceSession()
  sessionPollTimer = setInterval(pollDeviceSession, SESSION_POLL_MS)
}

function stopSessionPolling() {
  if (sessionPollTimer) {
    clearInterval(sessionPollTimer)
    sessionPollTimer = null
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    if (processApi.apitoken) {
      pollDeviceSession()
      startSessionPolling()
    }
    return
  }
  stopSessionPolling()
}

onMounted(() => {
  ensureNavbarLoadedForKiosk()
  if (processApi.apitoken) {
    processApi.refreshServerUrl()
    processApi.syncDeviceInfo()
  }
  startSessionPolling()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  stopSessionPolling()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

watch(isKioskShell, ensureNavbarLoadedForKiosk)
watch(
  () => processApi.apitoken,
  () => startSessionPolling()
)
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <NavBar />
    <main class="flex-1">
      <RouterView />
    </main>
    <NotificationHolder />
    <LoadingView v-if="loadingStore.loading" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import EventyayConfigurePanel from '@/components/Eventyay/EventyayConfigurePanel.vue'
import OfflineSyncStatus from '@/components/Utilities/OfflineSyncStatus.vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useLoadingStore } from '@/stores/loading'
import { useOfflineSyncStore } from '@/stores/offlineSync'
import { getEventyayLogoProps, getRoleLabel } from '@/utils/session'
import { isKioskEnvironment } from '@/utils/kioskLauncher'

const route = useRoute()
const processApi = useEventyayApi()
const loadingStore = useLoadingStore()
const offlineSync = useOfflineSyncStore()

loadingStore.navbarLoaded()

const showConfigurePanel = ref(false)

const isAuthenticated = computed(() => Boolean(processApi.apitoken))
const isKioskShell = computed(() => isKioskEnvironment(route))
const showConfigure = computed(() => {
  const role = processApi.selectedRole
  return (role === 'CheckIn' || role === 'Badge Station') && route.name === 'eventyaycheckin'
})

const showBar = computed(() => {
  if (!isAuthenticated.value || route.name === 'userAuth') {
    return false
  }
  if (isKioskShell.value) {
    return showConfigure.value
  }
  return true
})

const roleLabel = computed(() => getRoleLabel(processApi.selectedRole))
const eventLabel = computed(() => processApi.eventname || '')
const gateLabel = computed(() => processApi.gateName || '')
const deviceLabel = computed(() => processApi.deviceName || '')

const contextLabel = computed(() => {
  const parts = []
  if (eventLabel.value) {
    parts.push(eventLabel.value)
  }
  if (roleLabel.value) {
    parts.push(roleLabel.value)
  }
  if (gateLabel.value) {
    parts.push(gateLabel.value)
  } else if (deviceLabel.value) {
    parts.push(deviceLabel.value)
  }
  return parts.join(' · ')
})

async function logout() {
  await offlineSync.wipe()
  processApi.logout()
}

function openConfigure() {
  showConfigurePanel.value = true
}

function closeConfigure() {
  showConfigurePanel.value = false
}
</script>

<template>
  <header
    v-if="showBar"
    class="sticky top-0 z-20 border-b border-surface-border bg-surface/95 backdrop-blur-sm"
  >
    <div
      class="mx-auto flex h-11 max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
    >
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <img v-if="!isKioskShell" v-bind="getEventyayLogoProps('icon', 'h-7 w-7 shrink-0')" />
        <p v-if="contextLabel && !isKioskShell" class="min-w-0 truncate text-sm text-body-muted">
          {{ contextLabel }}
        </p>
        <p v-else-if="isKioskShell" class="text-sm font-medium text-body">Check-in</p>
      </div>

      <div class="flex shrink-0 items-center gap-4">
        <OfflineSyncStatus />
        <button
          v-if="showConfigure"
          type="button"
          class="text-sm font-medium text-primary transition hover:text-primary/80"
          @click="openConfigure"
        >
          Configure
        </button>
        <button
          v-if="!isKioskShell"
          type="button"
          class="text-sm text-body-muted transition hover:text-body"
          @click="logout"
        >
          Sign out
        </button>
      </div>
    </div>
  </header>

  <EventyayConfigurePanel v-if="showConfigurePanel" @close="closeConfigure" />
</template>

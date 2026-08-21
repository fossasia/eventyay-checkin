<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { LockClosedIcon, LockOpenIcon } from '@heroicons/vue/24/outline'
import EventyayConfigurePanel from '@/components/Eventyay/EventyayConfigurePanel.vue'
import PinUnlockModal from '@/components/Modals/PinUnlockModal.vue'
import PinSetupModal from '@/components/Modals/PinSetupModal.vue'
import OfflineSyncStatus from '@/components/Utilities/OfflineSyncStatus.vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useLoadingStore } from '@/stores/loading'
import { useOfflineSyncStore } from '@/stores/offlineSync'
import { useStationLockStore } from '@/stores/stationLock'
import { getEventyayLogoProps, getRoleLabel } from '@/utils/session'
import { isKioskEnvironment } from '@/utils/kioskLauncher'

const route = useRoute()
const processApi = useEventyayApi()
const loadingStore = useLoadingStore()
const offlineSync = useOfflineSyncStore()
const stationLock = useStationLockStore()

loadingStore.navbarLoaded()

const showConfigurePanel = ref(false)
const showUnlockModal = ref(false)
const showPinResetModal = ref(false)
const pendingAction = ref(null) // 'configure' | 'logout' | null

onMounted(() => {
  stationLock.syncLaunchLockState()
})

const isAuthenticated = computed(() => Boolean(processApi.apitoken))
const isKioskShell = computed(() => isKioskEnvironment(route))
const isCheckInRole = computed(() => processApi.selectedRole === 'CheckIn')
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

function handleLockToggle() {
  if (stationLock.isLocked) {
    pendingAction.value = null
    showUnlockModal.value = true
  } else {
    stationLock.lock()
  }
}

function handleConfigureClick() {
  if (stationLock.isActionLocked('configure')) {
    pendingAction.value = 'configure'
    showUnlockModal.value = true
    return
  }
  openConfigure()
}

function handleSignOutClick() {
  if (stationLock.isActionLocked('signOut')) {
    pendingAction.value = 'logout'
    showUnlockModal.value = true
    return
  }
  void logout()
}

function onUnlocked() {
  showUnlockModal.value = false
  if (pendingAction.value === 'configure') {
    pendingAction.value = null
    openConfigure()
  } else if (pendingAction.value === 'logout') {
    pendingAction.value = null
    void logout()
  }
}

function onResetPin() {
  showUnlockModal.value = false
  showPinResetModal.value = true
}

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
      class="mx-auto flex h-11 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:max-w-7xl 2xl:max-w-[1440px]"
    >
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <img v-if="!isKioskShell" v-bind="getEventyayLogoProps('icon', 'h-7 w-7 shrink-0')" />
        <p v-if="contextLabel && !isKioskShell" class="min-w-0 truncate text-sm text-body-muted">
          {{ contextLabel }}
        </p>
        <p v-else-if="isKioskShell" class="text-sm font-medium text-body">Check-in</p>
      </div>

      <div class="flex shrink-0 items-center gap-3 sm:gap-4">
        <!-- Station Lock Toggle Button -->
        <button
          v-if="isCheckInRole && stationLock.isEnabled"
          type="button"
          class="flex touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95"
          :class="[
            stationLock.isLocked
              ? 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20'
              : 'border border-success/30 bg-success/10 text-success hover:bg-success/20'
          ]"
          :aria-label="
            stationLock.isLocked
              ? 'Station locked. Click to unlock.'
              : 'Station unlocked. Click to lock.'
          "
          @click="handleLockToggle"
        >
          <LockClosedIcon v-if="stationLock.isLocked" class="h-3.5 w-3.5 shrink-0" />
          <LockOpenIcon v-else class="h-3.5 w-3.5 shrink-0" />
          <span>{{ stationLock.isLocked ? 'Locked' : 'Unlocked' }}</span>
        </button>

        <OfflineSyncStatus />

        <button
          v-if="showConfigure"
          type="button"
          class="text-sm font-medium text-primary transition hover:text-primary/80"
          @click="handleConfigureClick"
        >
          Configure
        </button>
        <button
          v-if="!isKioskShell"
          type="button"
          class="text-sm text-body-muted transition hover:text-body"
          @click="handleSignOutClick"
        >
          Sign out
        </button>
      </div>
    </div>
  </header>

  <EventyayConfigurePanel v-if="showConfigurePanel" @close="closeConfigure" />

  <PinUnlockModal
    v-if="showUnlockModal"
    :show="showUnlockModal"
    @close="showUnlockModal = false"
    @unlocked="onUnlocked"
    @reset-pin="onResetPin"
  />

  <PinSetupModal
    v-if="showPinResetModal"
    :show="showPinResetModal"
    @close="showPinResetModal = false"
    @saved="showPinResetModal = false"
  />
</template>

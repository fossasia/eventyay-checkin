<script setup>
import QRCamera from '@/components/Common/QRCamera.vue'
import BadgePrintPreview from '@/components/Common/BadgePrintPreview.vue'
import CheckInResultPopup from '@/components/Common/CheckInResultPopup.vue'
import { useLoadingStore } from '@/stores/loading'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { useEventyayApi } from '@/stores/eventyayapi'
import { storeToRefs } from 'pinia'
import { watch, ref, onUnmounted, computed } from 'vue'

const loadingStore = useLoadingStore()
loadingStore.contentLoaded()
const showPrintPreview = ref(false)
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const { message, showSuccess, showError, badgeUrl, isGeneratingBadge, alreadyCheckedIn } = storeToRefs(
  processEventyayCheckInStore
)
const processApi = useEventyayApi()
const { url, eventname } = processApi
const AUTO_CLOSE_SECONDS = 20
const KIOSK_OVERLAY_MS = 2500
const countdown = ref(5)
const timerInstance = ref(null)
const timeoutInstance = ref(null)
const notes = ref('')
const kioskOverlay = ref(null)
const kioskResetTimer = ref(null)

const isBadgeStation = computed(() => processApi.selectedRole === 'Badge Station')

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`
}

function startCountdown() {
  countdown.value = AUTO_CLOSE_SECONDS
  timerInstance.value = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(timerInstance.value)
      processEventyayCheckInStore.$reset()
    }
  }, 1000)
}

function stopTimer() {
  if (timerInstance.value) {
    clearInterval(timerInstance.value)
  }
  if (timeoutInstance.value) {
    clearTimeout(timeoutInstance.value)
  }
  if (kioskResetTimer.value) {
    clearTimeout(kioskResetTimer.value)
    kioskResetTimer.value = null
  }
}

function handleNotesInput() {
  stopTimer()
  countdown.value = '...'
}

function handleCancel() {
  processEventyayCheckInStore.$reset()
  stopTimer()
}

function handlePrintBadge() {
  if (badgeUrl.value) {
    showPrintPreview.value = true
  }
}

function handlePrintClose() {
  showPrintPreview.value = false
  if (isBadgeStation.value) {
    resetKioskFlow()
    return
  }
  startCountdown()
}

async function handlePrint() {
  stopTimer()
  handlePrintBadge()
}

function resetKioskFlow() {
  stopTimer()
  kioskOverlay.value = null
  showPrintPreview.value = false
  processEventyayCheckInStore.$reset()
}

function scheduleKioskReset(delay = KIOSK_OVERLAY_MS) {
  kioskResetTimer.value = setTimeout(resetKioskFlow, delay)
}

watch([showSuccess, showError], ([newSuccess, newError], [oldSuccess, oldError]) => {
  if ((!oldSuccess && newSuccess) || (!oldError && newError)) {
    showPopup()
  }
})

function showPopup() {
  if (isBadgeStation.value) {
    if (showError.value) {
      kioskOverlay.value = 'error'
      scheduleKioskReset()
      return
    }

    if (alreadyCheckedIn.value) {
      kioskOverlay.value = 'already'
      scheduleKioskReset()
      return
    }

    if (showSuccess.value) {
      if (badgeUrl.value) {
        kioskOverlay.value = 'printing'
        handlePrintBadge()
      } else {
        kioskOverlay.value = 'error'
        scheduleKioskReset()
      }
      return
    }
  }

  notes.value = ''
  startCountdown()
  timeoutInstance.value = setTimeout(() => {
    processEventyayCheckInStore.$reset()
  }, AUTO_CLOSE_SECONDS * 1000)
}

onUnmounted(() => {
  stopTimer()
})
</script>

<template>
  <div class="flex h-screen w-full flex-col items-center justify-center">
    <div class="absolute top-20 text-center">
      <h1 class="text-4xl font-bold">{{ eventname }}</h1>
      <p name="date" class="text-gray-600 text-lg font-semibold">{{ new Date().toDateString() }}</p>
    </div>
    <QRCamera qr-type="eventyaycheckin" scan-type="Check-In" />

    <div
      v-if="isBadgeStation && kioskOverlay"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75"
    >
      <div class="max-w-md px-6 text-center text-white">
        <template v-if="kioskOverlay === 'printing'">
          <div
            class="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-white/30 border-t-white"
          ></div>
          <p class="mt-6 text-2xl font-semibold">
            {{ message?.attendee_name || message?.attendee }}
          </p>
          <p class="mt-2 text-lg">Printing badge...</p>
        </template>
        <template v-else-if="kioskOverlay === 'already'">
          <p class="text-2xl font-semibold">Already checked in</p>
          <p class="mt-3 text-lg">{{ message?.attendee_name || message?.attendee }}</p>
          <p class="mt-2 text-sm text-white/80">Badge will not be printed again.</p>
        </template>
        <template v-else-if="kioskOverlay === 'error'">
          <p class="text-2xl font-semibold text-red-300">Check-in failed</p>
          <p v-if="message?.errorReason" class="mt-3 text-lg">{{ message.errorReason }}</p>
          <p v-else class="mt-3 text-lg">{{ message?.message }}</p>
        </template>
      </div>
    </div>

    <CheckInResultPopup
      v-if="!isBadgeStation && (showSuccess || showError) && message?.attendee"
      :message="message"
      :show-success="showSuccess"
      :show-error="showError"
      :badge-url="badgeUrl"
      :countdown="countdown"
      :is-generating-badge="isGeneratingBadge"
      @close="handleCancel"
      @print="handlePrint"
      @interact="handleNotesInput"
    />
    <BadgePrintPreview
      v-if="showPrintPreview"
      :url="joinUrl(url, badgeUrl)"
      :kiosk="isBadgeStation"
      @close="handlePrintClose"
    />
  </div>
</template>

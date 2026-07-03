<script setup>
import StandardButton from '@/components/Common/StandardButton.vue'
import QRCamera from '@/components/Common/QRCamera.vue'
import BadgePrintPreview from '@/components/Common/BadgePrintPreview.vue'
import CheckInResultPopup from '@/components/Common/CheckInResultPopup.vue'
import { useLoadingStore } from '@/stores/loading'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { useEventyayApi } from '@/stores/eventyayapi'
import { storeToRefs } from 'pinia'
import { watch, ref, onUnmounted } from 'vue'

const loadingStore = useLoadingStore()
loadingStore.contentLoaded()
const showPrintPreview = ref(false)
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const { message, showSuccess, showError, badgeUrl, isGeneratingBadge } = storeToRefs(
  processEventyayCheckInStore
)
const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug, eventname, selectedRole } = processApi
const AUTO_CLOSE_SECONDS = 20
const countdown = ref(5)
const timerInstance = ref(null)
const timeoutInstance = ref(null)
const notes = ref('')

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
}

function handleNotesInput() {
  stopTimer()
  countdown.value = '...'
}

function handleSave() {
  console.log('Saving notes:', notes.value)
  processEventyayCheckInStore.$reset()
  stopTimer()
}

function handleCancel() {
  processEventyayCheckInStore.$reset()
  stopTimer()
}

function handlePrintBadge() {
  console.log('Printing badge...')
  if (badgeUrl.value) {
    showPrintPreview.value = true
  }
}

function handlePrintClose() {
  showPrintPreview.value = false
  startCountdown()
}

async function handlePrint() {
  stopTimer()
  if (badgeUrl.value) {
    await processEventyayCheckInStore.printBadge(badgeUrl.value)
  }
  handlePrintBadge()
}

watch([showSuccess, showError], ([newSuccess, newError], [oldSuccess, oldError]) => {
  if ((!oldSuccess && newSuccess) || (!oldError && newError)) {
    showPopup()
  }
})

function showPopup() {
  notes.value = ''
  startCountdown()
  if (selectedRole === "Badge Station") { handlePrint() }
  timeoutInstance.value = setTimeout(() => {
    processEventyayCheckInStore.$reset()
  }, AUTO_CLOSE_SECONDS * 1000)
}

// Cleanup timers when component is destroyed
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
    <!-- Attendee Info Popup Modal -->
    <CheckInResultPopup
      v-if="(showSuccess || showError) && message?.attendee"
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
      @close="handlePrintClose"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useEventyayApi } from '@/stores/eventyayapi'

const MAX_RETRIES = 5

const processApi = useEventyayApi()
const { apitoken } = processApi

const props = defineProps({
  url: {
    type: String,
    required: true
  },
  kiosk: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

const isLoading = ref(true)
const printError = ref(false)
const pdfUrl = ref(null)
const pdfBlob = ref(null)
const hiddenFrame = ref(null)
let retryTimer = null
let closeTimer = null
let destroyed = false

// PDF Fetching
const fetchPDF = async (attempt = 0) => {
  isLoading.value = true
  printError.value = false

  try {
    const response = await fetch(props.url, {
      method: 'GET',
      headers: {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/pdf, application/json'
      }
    })

    if ((response.status === 202 || response.status === 409) && attempt < MAX_RETRIES) {
      retryTimer = setTimeout(() => fetchPDF(attempt + 1), 1000)
      return
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const data = await response.json()
      const base64 = data.pdf_base64 || data.base64_pdf
      if (!base64) throw new Error('Badge is still generating')
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      pdfBlob.value = new Blob([bytes], { type: 'application/pdf' })
    } else {
      pdfBlob.value = await response.blob()
    }

    if (destroyed) return
    pdfUrl.value = URL.createObjectURL(pdfBlob.value)
    isLoading.value = false
    if (props.kiosk) {
      handlePrint()
      closeTimer = setTimeout(() => emit('close'), 1500)
    }
  } catch (error) {
    if (destroyed) return
    console.error('Error fetching PDF:', error)
    printError.value = true
    isLoading.value = false
    if (props.kiosk) emit('close')
  }
}

// Print Strategies
const printStrategies = {
  // Fallback to standard print dialog
  standardPrint() {
    if (!pdfUrl.value) return

    const printWindow = window.open(pdfUrl.value)
    if (printWindow) {
      printWindow.addEventListener('load', () => {
        try {
          printWindow.print()
        } catch (error) {
          console.error('Standard print failed:', error)
          printError.value = true
        }
      })
    }
  },

  // Hidden iframe print attempt
  silentPrint() {
    if (!pdfUrl.value) return

    try {
      // Create hidden iframe if it doesn't exist
      if (!hiddenFrame.value) {
        hiddenFrame.value = document.createElement('iframe')
        hiddenFrame.value.style.position = 'fixed'
        hiddenFrame.value.style.width = '1px'
        hiddenFrame.value.style.height = '1px'
        hiddenFrame.value.style.opacity = '0.01'
        document.body.appendChild(hiddenFrame.value)
      }

      let hasPrinted = false
      const triggerPrint = () => {
        if (hasPrinted) return

        try {
          hiddenFrame.value.contentWindow.print()
          hasPrinted = true
        } catch (error) {
          console.error('Silent print failed:', error)
          printStrategies.standardPrint()
        }
      }

      hiddenFrame.value.onload = triggerPrint
      hiddenFrame.value.src = pdfUrl.value
      setTimeout(triggerPrint, 500)
    } catch (error) {
      console.error('Silent print preparation failed:', error)
      printStrategies.standardPrint()
    }
  }
}

const handlePrint = () => {
  printStrategies.silentPrint()
}

const handleDownload = () => {
  if (!pdfBlob.value) return

  const downloadUrl = URL.createObjectURL(pdfBlob.value)
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = 'badge.pdf'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(downloadUrl)
}

onMounted(() => {
  fetchPDF()
})

function reload() {
  fetchPDF()
}

onBeforeUnmount(() => {
  destroyed = true
  clearTimeout(retryTimer)
  clearTimeout(closeTimer)
  if (hiddenFrame.value) {
    document.body.removeChild(hiddenFrame.value)
  }
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
  }
})
</script>

<template>
  <div v-if="!kiosk" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
    <div class="relative rounded-lg bg-white p-4">
      <!-- Loading State -->
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-white">
        <div class="text-center">
          <div class="border-gray-900 h-12 w-12 animate-spin rounded-full border-b-2"></div>
          <p class="mt-2">Loading badge preview...</p>
        </div>
      </div>

      <!-- Error State -->
      <div v-if="printError" class="bg-red-100 mb-4 rounded-lg p-4">
        <p class="text-red-700">
          Badge Might Not be ready yet, please
          <span class="text-primary" @click="reload">refresh</span> and Try Again
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="mb-4 flex gap-2">
        <StandardButton
          type="button"
          text="Print"
          class="btn-primary"
          :disabled="isLoading || !pdfUrl"
          @click="handlePrint"
        />
        <StandardButton
          type="button"
          text="Download"
          class="btn-secondary"
          :disabled="isLoading || !pdfBlob"
          @click="handleDownload"
        />
        <StandardButton type="button" text="Close" class="btn-white" @click="emit('close')" />
      </div>

      <!-- PDF Preview -->
    </div>
  </div>
</template>

<style scoped>
/* Ensure full visibility of PDF viewer */
iframe,
object {
  width: 100%;
  height: 100%;
  border: none;
}
</style>

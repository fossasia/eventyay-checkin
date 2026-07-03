<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import printJS from 'print-js'

const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug, eventname, selectedRole} = processApi
const props = defineProps({
  url: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['close'])

// State Management
const isLoading = ref(true)
const printError = ref(false)
const pdfUrl = ref(null)
const pdfBlob = ref(null)
const hiddenFrame = ref(null)

// PDF Fetching
const fetchPDF = async () => {
  try {
    const response = await fetch(props.url, {
      method: 'GET',
      headers: {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/json'
      },
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    pdfBlob.value = await response.blob()
    pdfUrl.value = URL.createObjectURL(pdfBlob.value)
    isLoading.value = false
    if (selectedRole === "Badge Station") {
      handlePrint()
      setTimeout(() => {
        emit('close')
      }, 5000)
    }
  } catch (error) {
    console.error('Error fetching PDF:', error)
    printError.value = true
    isLoading.value = false
  }
}

// Print Strategies
const printStrategies = {
  // Use robust print-js library for printing PDFs in both standard and silent modes
  silentPrint() {
    if (!pdfUrl.value) return

    try {
      printJS({
        printable: pdfUrl.value,
        type: 'pdf',
        showModal: false,
        onError: (error) => {
          console.error('Silent print failed:', error)
          printError.value = true
        }
      })
    } catch (error) {
      console.error('Silent print preparation failed:', error)
      printError.value = true
    }
  },
  
  standardPrint() {
    this.silentPrint() // printJS is perfectly suitable for standard prints too
  }
}

// PDF Viewer Strategies
// Determine best PDF viewer

// Print handler with multiple strategies
const handlePrint = () => {
  // Try silent print first
  printStrategies.silentPrint()
}
// Download handler
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

// Lifecycle hooks
onMounted(() => {
  fetchPDF()
})

function reload() {
  window.location.reload()
}

onBeforeUnmount(() => {
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
  }
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
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

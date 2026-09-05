<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { XMarkIcon } from '@heroicons/vue/20/solid'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { printPdfBlob, cancelActivePrint } from '@/utils/badgePdf'
import { isKioskEnvironment } from '@/utils/kioskLauncher'

const route = useRoute()
const processEventyayCheckInStore = useProcessEventyayCheckInStore()

const props = defineProps({
  badgePath: {
    type: String,
    required: true
  },
  layouts: {
    type: Array,
    default: () => []
  },
  initialLayoutId: {
    type: [Number, String],
    default: null
  },
  position: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close'])

const isLoading = ref(true)
const printError = ref(false)
const pdfUrl = ref(null)
const pdfBlob = ref(null)
const loadError = ref('')
const selectedLayoutId = ref('')

const showLayoutSelect = computed(() => Array.isArray(props.layouts) && props.layouts.length > 0)

function resolveInitialLayoutId() {
  if (props.initialLayoutId != null && props.initialLayoutId !== '') {
    return String(props.initialLayoutId)
  }
  const defaultLayout = (props.layouts || []).find((layout) => layout.default)
  if (defaultLayout) {
    return String(defaultLayout.id)
  }
  if (props.layouts?.length) {
    return String(props.layouts[0].id)
  }
  return ''
}

watch(
  () => [props.initialLayoutId, props.layouts],
  () => {
    selectedLayoutId.value = resolveInitialLayoutId()
  },
  { immediate: true }
)

const revokePdfUrl = () => {
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
    pdfUrl.value = null
  }
}

const fetchPDF = async () => {
  isLoading.value = true
  printError.value = false
  loadError.value = ''
  revokePdfUrl()
  pdfBlob.value = null

  try {
    const result = await processEventyayCheckInStore.getBadgeBlob(props.badgePath, {
      layoutId: selectedLayoutId.value || null,
      positionHint: props.position
    })
    if (!result?.blob) {
      printError.value = true
      loadError.value =
        result?.detail || 'Could not load the badge PDF. Check your connection and try Print again.'
      return
    }

    pdfBlob.value = result.blob
    pdfUrl.value = URL.createObjectURL(result.blob)
  } catch (error) {
    console.error('Error fetching PDF:', error)
    printError.value = true
    loadError.value = 'Could not load the badge PDF. Check your connection and try Print again.'
  } finally {
    isLoading.value = false
  }
}

watch(
  () => [props.badgePath, selectedLayoutId.value],
  () => {
    if (!props.badgePath && !props.position) {
      return
    }
    void fetchPDF()
  },
  { immediate: true }
)

const handlePrint = async () => {
  if (!pdfBlob.value) {
    return
  }

  await printPdfBlob(pdfBlob.value, { silent: isKioskEnvironment(route) })
}

const handleDownload = () => {
  if (!pdfBlob.value) {
    return
  }

  const downloadUrl = URL.createObjectURL(pdfBlob.value)
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = 'badge.pdf'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(downloadUrl)
}

onBeforeUnmount(() => {
  cancelActivePrint()
  revokePdfUrl()
})
</script>

<template>
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
    <div class="card relative w-full max-w-lg p-5 pt-14">
      <button
        type="button"
        class="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-body transition hover:bg-surface-border hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label="Close preview"
        @click="emit('close')"
      >
        <XMarkIcon class="h-7 w-7" />
      </button>
      <h2 class="mb-4">Badge preview</h2>

      <div v-if="showLayoutSelect" class="mb-4">
        <label for="badge-print-layout-select" class="text-sm font-medium text-body">
          Badge layout
        </label>
        <select
          id="badge-print-layout-select"
          v-model="selectedLayoutId"
          class="mt-1 w-full"
          aria-label="Badge layout"
        >
          <option v-for="layout in layouts" :key="layout.id" :value="String(layout.id)">
            {{ layout.name }}{{ layout.default ? ' (default)' : '' }}
          </option>
        </select>
      </div>

      <div v-if="isLoading" class="py-10 text-center text-sm text-body-muted">Loading badge...</div>

      <div
        v-else-if="printError"
        class="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
      >
        {{ loadError }}
      </div>

      <embed
        v-else-if="pdfUrl"
        :src="pdfUrl"
        type="application/pdf"
        title="Badge preview"
        class="mb-4 h-[28rem] w-full rounded-xl border border-surface-border"
      />

      <div class="flex flex-wrap gap-2">
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
          class="btn-white"
          :disabled="isLoading || !pdfBlob"
          @click="handleDownload"
        />
        <StandardButton type="button" text="Close" class="btn-white" @click="emit('close')" />
      </div>
    </div>
  </div>
</template>

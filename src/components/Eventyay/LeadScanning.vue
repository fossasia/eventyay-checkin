<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { XMarkIcon } from '@heroicons/vue/20/solid'
import { createAuthorizedExhibitorApi, exhibitorApiPath } from '@/utils/serverUrl'
import { handleExhibitorApiError } from '@/utils/deviceErrors'
import QRCamera from '@/components/Common/QRCamera.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import TagInput from '@/components/Common/TagInput.vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useLeadScanStore } from '@/stores/leadscan'
import { useLoadingStore } from '@/stores/loading'
import { useTagStore } from '@/stores/tags'

const loadingStore = useLoadingStore()
const leadScanStore = useLeadScanStore()
const tagStore = useTagStore()
const processApi = useEventyayApi()
const { exhiname, boothname, boothid } = storeToRefs(processApi)
const { message, showSuccess, showError, currentLeadId } = storeToRefs(leadScanStore)
const { currentTags } = storeToRefs(tagStore)

const countdown = ref(5)
const countdownPaused = ref(false)
const timerInstance = ref(null)
const timeoutInstance = ref(null)
const notes = ref('')
const manualCode = ref('')
const saveError = ref('')
const isSaving = ref(false)

const resultLabel = computed(() => {
  if (message.value?.alreadyScanned) {
    return 'Lead already scanned'
  }
  if (showError.value) {
    return 'Lead scan issue'
  }
  return 'Lead captured'
})

function detailRepeatsLabel(label, detail) {
  const normalize = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/g, '')
      .replace(/-/g, ' ')

  const normalizedLabel = normalize(label)
  const normalizedDetail = normalize(detail)

  if (!normalizedDetail) {
    return true
  }
  if (normalizedDetail === normalizedLabel) {
    return true
  }
  if (normalizedDetail.includes(normalizedLabel) || normalizedLabel.includes(normalizedDetail)) {
    return true
  }
  return false
}

const leadHelperText = computed(() => {
  const label = resultLabel.value
  const detail = String(message.value?.message || '').trim()

  if (!detail || detailRepeatsLabel(label, detail)) {
    return ''
  }

  return detail
})

const resultToneClass = computed(() => (showError.value ? 'text-danger' : 'text-success'))

const showCountdown = computed(() => !countdownPaused.value && countdown.value > 0)

const countdownLabel = computed(() => {
  const seconds = Number(countdown.value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return ''
  }
  return `Closing in ${seconds}`
})

async function submitManualLead() {
  const code = manualCode.value.trim()
  if (!code) return

  loadingStore.contentLoading()
  try {
    await leadScanStore.scanLeadByCode(code)
    manualCode.value = ''
  } catch (error) {
    console.error('Failed to submit manual lead:', error)
  } finally {
    loadingStore.contentLoaded()
  }
}

loadingStore.contentLoaded()

onMounted(() => {
  leadScanStore.prefetchLeads()
})

function startCountdown() {
  countdownPaused.value = false
  countdown.value = 5
  timerInstance.value = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      clearInterval(timerInstance.value)
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
  countdownPaused.value = true
}

async function handleSave() {
  const url = processApi.url
  const apitoken = processApi.apitoken
  const organizer = processApi.organizer
  const eventSlug = processApi.eventSlug
  const exikey = processApi.exikey

  if (!url || !apitoken || !organizer || !eventSlug || !exikey || !currentLeadId.value) {
    return
  }

  stopTimer()
  saveError.value = ''
  isSaving.value = true

  const api = createAuthorizedExhibitorApi(url, apitoken, exikey)

  try {
    await api.post(exhibitorApiPath(organizer, eventSlug, `lead/${currentLeadId.value}/update`), {
      note: notes.value,
      tags: currentTags.value
    })
    tagStore.reset()
    leadScanStore.$reset()
    notes.value = ''
  } catch (error) {
    handleExhibitorApiError(error, processApi, {
      onError: (msg) => {
        saveError.value = msg
      }
    })
  } finally {
    isSaving.value = false
  }
}

function handleCancel() {
  stopTimer()
  saveError.value = ''
  notes.value = ''
  tagStore.reset()
  leadScanStore.$reset()
}

function handleClose() {
  handleCancel()
}

watch([showSuccess, showError], ([newSuccess, newError]) => {
  if (newSuccess || (newError && message.value.attendee)) {
    showPopup()
  }
})

function showPopup() {
  stopTimer()
  saveError.value = ''
  notes.value = ''
  tagStore.reset()
  countdownPaused.value = false
  startCountdown()
  timeoutInstance.value = setTimeout(() => {
    leadScanStore.$reset()
  }, 5000)
}
</script>

<template>
  <div class="page-shell">
    <div class="mb-5 text-center">
      <h1>Lead scanning</h1>
      <p class="mt-1 text-sm text-body-muted">{{ exhiname }}</p>
      <p v-if="boothname || boothid" class="text-xs text-body-muted">
        {{ boothname }}<span v-if="boothid"> · Booth {{ boothid }}</span>
      </p>
    </div>

    <div class="mx-auto max-w-md">
      <section class="card p-5 sm:p-6">
        <QRCamera qr-type="eventyaylead" scan-type="Lead scan" />
        <div class="mt-4 border-t border-surface-border pt-4">
          <p class="text-xs font-semibold text-body-muted uppercase tracking-wide mb-2 text-center">
            Or enter lead code manually
          </p>
          <form class="flex gap-2" @submit.prevent="submitManualLead">
            <input
              id="manual-lead-code"
              v-model="manualCode"
              type="text"
              placeholder="Lead code or scan badge QR"
              class="flex-1 min-w-0"
              required
            />
            <StandardButton
              type="submit"
              text="Scan"
              variant="primary"
            />
          </form>
        </div>
        <StandardButton
          text="Download leads"
          class="btn-white mt-4 w-full justify-center"
          @click="leadScanStore.exportLeads"
        />
      </section>
    </div>

    <Transition name="modal">
      <div
        v-if="(showSuccess || showError) && message.attendee"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      >
        <div class="card relative w-full max-w-md p-6 pt-14">
          <div class="absolute right-4 top-4 flex items-center gap-3">
            <div
              v-if="showCountdown"
              class="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-medium tabular-nums text-body-muted whitespace-nowrap"
            >
              {{ countdownLabel }}
            </div>
            <button
              type="button"
              class="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-body transition hover:bg-surface-border hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              aria-label="Close"
              @click="handleClose"
            >
              <XMarkIcon class="h-7 w-7" />
            </button>
          </div>

          <h2 class="mb-1 text-xl" :class="resultToneClass">
            {{ resultLabel }}
          </h2>
          <p v-if="leadHelperText" class="mb-4 text-sm text-body-muted">
            {{ leadHelperText }}
          </p>
          <div v-else class="mb-4" />

          <dl class="space-y-2 border-t border-surface-border pt-4 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-body-muted">Name</dt>
              <dd class="text-right font-medium">{{ message.attendee.name || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-body-muted">Email</dt>
              <dd class="break-all text-right">{{ message.attendee.email || '—' }}</dd>
            </div>
          </dl>

          <div class="mt-4 space-y-3" @click="handleNotesInput">
            <TagInput v-model="currentTags" />
            <textarea
              v-model="notes"
              rows="3"
              class="w-full"
              placeholder="Notes"
              @focus="handleNotesInput"
              @input="handleNotesInput"
            />
          </div>

          <p v-if="saveError" class="mt-4 text-sm text-danger">{{ saveError }}</p>

          <div class="mt-5 flex gap-2">
            <StandardButton
              type="button"
              text="Save"
              class="btn-primary flex-1 justify-center"
              :disabled="isSaving"
              @click="handleSave"
            />
            <StandardButton
              type="button"
              text="Cancel"
              class="btn-white flex-1 justify-center"
              @click="handleCancel"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

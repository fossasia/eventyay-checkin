<script setup>
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { createAuthorizedExhibitorApi, exhibitorApiPath } from '@/utils/serverUrl'
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
const timerInstance = ref(null)
const timeoutInstance = ref(null)
const notes = ref('')
const manualCode = ref('')

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

function startCountdown() {
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
  countdown.value = '...'
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
    console.error('Failed to save lead:', error)
  }
}

function handleCancel() {
  notes.value = ''
  tagStore.reset()
  leadScanStore.$reset()
}

watch([showSuccess, showError], ([newSuccess, newError]) => {
  if (newSuccess || (newError && message.value.attendee)) {
    showPopup()
  }
})

function showPopup() {
  notes.value = ''
  tagStore.reset()
  if (message.value.lead_id) {
    currentLeadId.value = message.value.lead_id
  }
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
        <div class="card relative w-full max-w-md p-6">
          <div
            class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-body-muted"
          >
            {{ countdown }}
          </div>

          <p
            class="mb-1 text-xs font-semibold uppercase tracking-wide"
            :class="showError ? 'text-danger' : 'text-success'"
          >
            Lead captured
          </p>
          <h2 class="mb-4" :class="showError ? 'text-danger' : 'text-success'">
            {{ message.message }}
          </h2>

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

          <div class="mt-5 flex gap-2">
            <StandardButton
              type="button"
              text="Save"
              class="btn-primary flex-1 justify-center"
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

<script setup>
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import StandardButton from '@/components/Common/StandardButton.vue'
import PinSetupModal from '@/components/Modals/PinSetupModal.vue'
import { useCameraStore } from '@/stores/camera'
import { useCheckinSettingsStore } from '@/stores/checkinSettings'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useEventyayEventStore } from '@/stores/eventyayEvent'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { useStationLockStore } from '@/stores/stationLock'
import { formatEventDate, getEventDisplayName } from '@/utils/eventFormat'
import { isKioskEnvironment } from '@/utils/kioskLauncher'
import { useRoute } from 'vue-router'

const emit = defineEmits(['close'])

const route = useRoute()
const processApi = useEventyayApi()
const eventStore = useEventyayEventStore()
const checkinSettings = useCheckinSettingsStore()
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const stationLock = useStationLockStore()
const cameraStore = useCameraStore()

const showPinSetup = ref(false)

const { selectedRole, limitCheckInLists, gateName, deviceName } = storeToRefs(processApi)
const { events } = storeToRefs(eventStore)
const { availableCheckInLists } = storeToRefs(processEventyayCheckInStore)
const { autoPrintEnabled } = storeToRefs(checkinSettings)
const { isEnabled: isPinLockEnabled, isLocked: isStationLocked } = storeToRefs(stationLock)

const isUnlocked = ref(false)
const setupToken = ref('')
const unlockError = ref('')
const unlocking = ref(false)

const draftEventSlug = ref('')
const draftCheckInListId = ref(null)
const draftAutoPrint = ref(true)
const loadingLists = ref(false)
const saving = ref(false)
const errorMessage = ref('')

const isBadgeStation = computed(() => selectedRole.value === 'Badge Station')
const isKioskShell = computed(() => isKioskEnvironment(route))

const selectableEvents = computed(() => {
  const now = new Date()
  return events.value.filter((event) => new Date(event.date_to) >= now)
})

const checkInListEmptyMessage = computed(() => {
  if (limitCheckInLists.value?.length) {
    return 'No check-in lists match this device restriction for the selected event.'
  }
  return 'No check-in lists found for this event.'
})

function resetDraftFromStore() {
  draftEventSlug.value = processApi.eventSlug || ''
  draftCheckInListId.value = processApi.selectedCheckInListId
  checkinSettings.syncAutoPrintForRole(selectedRole.value)
  draftAutoPrint.value = autoPrintEnabled.value
  errorMessage.value = ''
}

function resetUnlockState() {
  isUnlocked.value = false
  setupToken.value = ''
  unlockError.value = ''
  unlocking.value = false
}

async function loadListsForDraftEvent() {
  if (!draftEventSlug.value) {
    draftCheckInListId.value = null
    return
  }

  loadingLists.value = true
  try {
    await processEventyayCheckInStore.getCheckInLists({
      force: true,
      eventSlug: draftEventSlug.value
    })
    const lists = availableCheckInLists.value
    const currentId = draftCheckInListId.value
    const stillValid = lists.some((list) => String(list.id) === String(currentId))
    if (!stillValid) {
      draftCheckInListId.value = lists.length === 1 ? lists[0].id : null
    }
  } catch (error) {
    console.error('Failed to load check-in lists:', error)
    errorMessage.value = 'Could not load check-in lists for this event.'
  } finally {
    loadingLists.value = false
  }
}

watch(
  () => draftEventSlug.value,
  (slug, previousSlug) => {
    if (slug === previousSlug) {
      return
    }
    void loadListsForDraftEvent()
  }
)

async function openPanel() {
  resetUnlockState()
  resetDraftFromStore()
}

void openPanel()

async function unlockPanel() {
  const token = setupToken.value.trim()
  if (!token) {
    unlockError.value = 'Enter the device setup token to continue.'
    return
  }

  unlocking.value = true
  unlockError.value = ''

  try {
    const result = await processApi.verifySetupToken(token)
    if (!result.success) {
      if (result.error === 'missing_credentials') {
        unlockError.value = 'Enter the device setup token to continue.'
      } else {
        unlockError.value =
          result.message ||
          'Could not verify the setup token. Check the token on the organizer device connect page and try again.'
      }
      return
    }

    isUnlocked.value = true
    if (!events.value.length) {
      await eventStore.fetchEvents()
    }
    if (draftEventSlug.value) {
      await loadListsForDraftEvent()
    }
  } catch (error) {
    console.error('Failed to verify setup token:', error)
    unlockError.value = 'Could not verify the setup token. Try again.'
  } finally {
    unlocking.value = false
  }
}

async function closePanel() {
  if (processApi.eventSlug) {
    await processEventyayCheckInStore.getCheckInLists({ force: true })
  }
  emit('close')
}

async function applySettings() {
  if (!draftEventSlug.value) {
    errorMessage.value = 'Select an event to continue.'
    return
  }

  if (!draftCheckInListId.value) {
    errorMessage.value = 'Select a check-in list to continue.'
    return
  }

  saving.value = true
  errorMessage.value = ''

  try {
    const eventData = events.value.find((event) => event.slug === draftEventSlug.value)
    const eventChanged = draftEventSlug.value !== processApi.eventSlug
    const listChanged =
      String(draftCheckInListId.value) !== String(processApi.selectedCheckInListId)

    processApi.setEvent(draftEventSlug.value, getEventDisplayName(eventData))
    processApi.setSelectedCheckInListId(draftCheckInListId.value)

    if (isBadgeStation.value) {
      checkinSettings.setAutoPrintForRole(selectedRole.value, draftAutoPrint.value)
    }

    if (eventChanged) {
      await processEventyayCheckInStore.reloadCheckInListsForCurrentEvent()
    }

    if (eventChanged || listChanged) {
      processEventyayCheckInStore.$reset()
      cameraStore.clearLastScan()
    }

    emit('close')
  } catch (error) {
    console.error('Failed to apply check-in settings:', error)
    errorMessage.value = 'Could not save settings. Try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
    <div class="card flex max-h-[min(90dvh,720px)] w-full max-w-lg flex-col overflow-hidden">
      <div class="border-b border-surface-border px-5 py-4 sm:px-6">
        <h2 class="text-lg font-semibold text-body">Configure</h2>
        <p v-if="isUnlocked" class="mt-1 text-sm text-body-muted">
          Event, check-in list, and printing options for this device.
        </p>
        <p v-else class="mt-1 text-sm text-body-muted">
          Enter the device setup token from the organizer connect page to change settings.
        </p>
      </div>

      <div v-if="!isUnlocked" class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
        <label class="block">
          <span class="section-title mb-2 block">Setup token</span>
          <input
            v-model="setupToken"
            type="password"
            autocomplete="off"
            class="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-body"
            placeholder="Paste or type the setup token"
            :disabled="unlocking"
            @keyup.enter="unlockPanel"
          />
        </label>
        <p class="text-xs text-body-muted">
          Copy or download this token from the device connect page in the organizer dashboard. Keep
          it handy if you switch between events or check-in lists on this device.
        </p>
        <p v-if="unlockError" class="text-sm text-danger">{{ unlockError }}</p>
      </div>

      <div v-else class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6">
        <div
          v-if="gateName || deviceName"
          class="rounded-xl border border-surface-border bg-surface-muted px-4 py-3 text-sm text-body-muted"
        >
          <p v-if="gateName"><span class="font-medium text-body">Gate:</span> {{ gateName }}</p>
          <p v-if="deviceName" class="mt-1">
            <span class="font-medium text-body">Device:</span> {{ deviceName }}
          </p>
        </div>

        <div>
          <p class="section-title mb-3">Event</p>
          <div v-if="!selectableEvents.length" class="text-sm text-body-muted">
            No upcoming events available.
          </div>
          <div v-else class="max-h-48 space-y-2 overflow-y-auto">
            <label
              v-for="event in selectableEvents"
              :key="event.slug"
              class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition"
              :class="
                draftEventSlug === event.slug
                  ? 'border-primary bg-primary/5'
                  : 'border-surface-border hover:border-primary/30'
              "
            >
              <input v-model="draftEventSlug" type="radio" :value="event.slug" class="mt-1" />
              <div class="min-w-0">
                <p class="font-medium text-body">{{ getEventDisplayName(event) }}</p>
                <p class="mt-0.5 text-xs text-body-muted">{{ formatEventDate(event.date_from) }}</p>
              </div>
            </label>
          </div>
        </div>

        <div v-if="draftEventSlug">
          <p class="section-title mb-3">Check-in list</p>
          <div v-if="loadingLists" class="text-sm text-body-muted">Loading lists…</div>
          <div v-else-if="availableCheckInLists.length" class="max-h-40 space-y-2 overflow-y-auto">
            <label
              v-for="list in availableCheckInLists"
              :key="list.id"
              class="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition"
              :class="
                String(draftCheckInListId) === String(list.id)
                  ? 'border-primary bg-primary/5'
                  : 'border-surface-border hover:border-primary/30'
              "
            >
              <input v-model="draftCheckInListId" type="radio" :value="list.id" />
              <div>
                <p class="font-medium text-body">{{ list.name }}</p>
                <p v-if="list.all_products" class="mt-0.5 text-xs text-body-muted">All products</p>
              </div>
            </label>
          </div>
          <p v-else class="text-sm text-danger">{{ checkInListEmptyMessage }}</p>
        </div>

        <div class="space-y-3 border-t border-surface-border pt-4">
          <p class="section-title">Security & Station Lock</p>
          <div
            class="flex items-center justify-between rounded-xl border border-surface-border bg-surface-muted p-4"
          >
            <div>
              <p class="text-sm font-semibold text-body">
                Station PIN Lock:
                <span :class="isPinLockEnabled ? 'font-bold text-success' : 'text-body-muted'">
                  {{
                    isPinLockEnabled
                      ? isStationLocked
                        ? 'Enabled (Locked)'
                        : 'Enabled (Unlocked)'
                      : 'Disabled'
                  }}
                </span>
              </p>
              <p class="text-xs text-body-muted">
                {{
                  isPinLockEnabled
                    ? 'Prevents walk-in registration, layout switching, and unauthorized attendee edits.'
                    : 'Set a numeric PIN to protect sensitive actions on unattended devices.'
                }}
              </p>
            </div>
            <StandardButton
              type="button"
              :text="isPinLockEnabled ? 'Manage PIN' : 'Set PIN'"
              variant="secondary"
              size="sm"
              @click="showPinSetup = true"
            />
          </div>
        </div>

        <div v-if="isBadgeStation" class="space-y-3 border-t border-surface-border pt-4">
          <p class="section-title">Printing</p>

          <label
            class="flex items-center justify-between gap-4 rounded-xl border border-surface-border px-4 py-3"
          >
            <div>
              <p class="text-sm font-semibold text-body">Auto-print badge</p>
              <p class="text-xs text-body-muted">Print immediately after each successful scan.</p>
            </div>
            <input
              v-model="draftAutoPrint"
              type="checkbox"
              class="h-4 w-4 rounded border-surface-border"
            />
          </label>

          <p v-if="draftAutoPrint && !isKioskShell" class="text-xs text-body-muted">
            For silent printing without dialogs, run the app in kiosk mode (`?kiosk=true`).
          </p>
        </div>

        <p v-if="errorMessage" class="text-sm text-danger">{{ errorMessage }}</p>
      </div>

      <div class="flex gap-2 border-t border-surface-border px-5 py-4 sm:px-6">
        <StandardButton
          type="button"
          text="Cancel"
          variant="white"
          block
          :disabled="saving || unlocking"
          @click="closePanel"
        />
        <StandardButton
          v-if="!isUnlocked"
          type="button"
          :text="unlocking ? 'Verifying…' : 'Continue'"
          variant="primary"
          block
          :disabled="unlocking || !setupToken.trim()"
          @click="unlockPanel"
        />
        <StandardButton
          v-else
          type="button"
          :text="saving ? 'Saving…' : 'Save'"
          variant="primary"
          block
          :disabled="saving || !draftEventSlug || !draftCheckInListId"
          @click="applySettings"
        />
      </div>
    </div>
  </div>

  <PinSetupModal
    v-if="showPinSetup"
    :show="showPinSetup"
    @close="showPinSetup = false"
    @saved="showPinSetup = false"
  />
</template>

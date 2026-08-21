<script setup>
import { reactive, ref, onMounted, onUnmounted } from 'vue'
import { LockClosedIcon } from '@heroicons/vue/24/outline'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useStationLockStore, DEFAULT_LOCKED_ACTIONS } from '@/stores/stationLock'

const props = defineProps({
  show: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['close', 'saved'])

const stationLock = useStationLockStore()

const pin = ref('')
const confirmPin = ref('')
const autoLock = ref(true)
const displayMode = ref('badge')
const error = ref('')
const isSaving = ref(false)

const actions = reactive({ ...DEFAULT_LOCKED_ACTIONS })

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  if (stationLock.isEnabled) {
    autoLock.value = stationLock.autoLockOnLaunch
    displayMode.value = stationLock.lockedDisplayMode
    Object.assign(actions, stationLock.lockedActions)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

function handleKeydown(event) {
  if (!props.show) {
    return
  }
  if (event.key === 'Escape') {
    emit('close')
  }
}

async function savePinSettings() {
  error.value = ''

  const cleanPin = pin.value.trim()
  const cleanConfirm = confirmPin.value.trim()

  if (!stationLock.isEnabled || cleanPin) {
    if (!/^\d{4,6}$/.test(cleanPin)) {
      error.value = 'PIN must be between 4 and 6 numeric digits.'
      return
    }

    if (cleanPin !== cleanConfirm) {
      error.value = 'PIN and Confirmation PIN do not match.'
      return
    }
  }

  isSaving.value = true
  try {
    if (cleanPin) {
      await stationLock.setPin(cleanPin, {
        lockedActions: { ...actions },
        autoLockOnLaunch: autoLock.value,
        lockedDisplayMode: displayMode.value
      })
    } else if (stationLock.isEnabled) {
      // Just update toggles without changing PIN
      stationLock.lockedActions = { ...actions }
      stationLock.autoLockOnLaunch = autoLock.value
      stationLock.lockedDisplayMode = displayMode.value
    }
    emit('saved')
    emit('close')
  } catch (err) {
    console.error('Failed to save PIN:', err)
    error.value = err.message || 'Failed to save PIN settings.'
  } finally {
    isSaving.value = false
  }
}

function removePinLock() {
  stationLock.removePin()
  emit('saved')
  emit('close')
}
</script>

<template>
  <div
    v-if="show"
    role="dialog"
    aria-modal="true"
    aria-label="Station PIN Lock Settings"
    class="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
  >
    <div
      class="card animate-in fade-in zoom-in-95 flex max-h-[min(90dvh,680px)] w-full max-w-lg flex-col overflow-hidden shadow-2xl duration-150"
    >
      <!-- Header -->
      <div class="border-b border-surface-border px-5 py-4 sm:px-6">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:h-11 sm:w-11"
          >
            <LockClosedIcon class="h-6 w-6" />
          </div>
          <div>
            <h3 class="text-base font-bold text-body sm:text-lg">Station PIN Lock Settings</h3>
            <p class="text-xs text-body-muted">
              Prevent unauthorized actions when the check-in station is unattended.
            </p>
          </div>
        </div>
      </div>

      <!-- Scrollable Form Body -->
      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
        <!-- PIN Input Fields -->
        <div class="space-y-3 rounded-2xl border border-surface-border bg-surface-muted p-4">
          <h4 class="text-xs font-bold uppercase tracking-wider text-body-muted">
            {{ stationLock.isEnabled ? 'Change Station PIN' : 'Set Station PIN' }}
          </h4>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs font-semibold text-body">
                {{ stationLock.isEnabled ? 'New PIN (4–6 digits)' : 'Station PIN (4–6 digits)' }}
              </label>
              <input
                v-model="pin"
                type="password"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="6"
                placeholder="4–6 digit PIN"
                class="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold text-body">Confirm PIN</label>
              <input
                v-model="confirmPin"
                type="password"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="6"
                placeholder="Re-enter PIN"
                class="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <p v-if="stationLock.isEnabled" class="text-[11px] text-body-muted">
            Leave PIN fields blank if you only wish to update locked actions or launch preferences.
          </p>
        </div>

        <!-- Locked Action Toggles -->
        <div class="space-y-3">
          <h4 class="text-xs font-bold uppercase tracking-wider text-body-muted">
            Protected Actions (When Station is Locked)
          </h4>

          <div class="space-y-2">
            <label
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
            >
              <div>
                <p class="text-sm font-semibold text-body">Live Registration</p>
                <p class="text-xs text-body-muted">
                  Prevent walk-in ticket orders and registration.
                </p>
              </div>
              <input
                v-model="actions.liveRegistration"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
              />
            </label>

            <label
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
            >
              <div>
                <p class="text-sm font-semibold text-body">Attendee Details Editing</p>
                <p class="text-xs text-body-muted">
                  Block editing attendee name, email, or question fields.
                </p>
              </div>
              <input
                v-model="actions.attendeeEdit"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
              />
            </label>

            <label
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
            >
              <div>
                <p class="text-sm font-semibold text-body">Badge Layout Selection</p>
                <p class="text-xs text-body-muted">
                  Lock printing to the default badge layout only.
                </p>
              </div>
              <input
                v-model="actions.badgeLayout"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
              />
            </label>

            <label
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
            >
              <div>
                <p class="text-sm font-semibold text-body">Configure Panel</p>
                <p class="text-xs text-body-muted">
                  Require PIN or Setup Token to access device settings.
                </p>
              </div>
              <input
                v-model="actions.configure"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
              />
            </label>

            <label
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
            >
              <div>
                <p class="text-sm font-semibold text-body">Badge Field Customization</p>
                <p class="text-xs text-body-muted">
                  Prevent changing printed badge field overrides before printing.
                </p>
              </div>
              <input
                v-model="actions.badgeCustomize"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
              />
            </label>

            <label
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
            >
              <div>
                <p class="text-sm font-semibold text-body">Attendee Search List</p>
                <p class="text-xs text-body-muted">
                  Restrict check-in to QR/barcode scanning only (hide search table).
                </p>
              </div>
              <input
                v-model="actions.search"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
              />
            </label>

            <label
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
            >
              <div>
                <p class="text-sm font-semibold text-body">Manual Check-In / Check-Out Override</p>
                <p class="text-xs text-body-muted">
                  Prevent manually re-checking in or checking out attendees.
                </p>
              </div>
              <input
                v-model="actions.manualOverride"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
              />
            </label>

            <label
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
            >
              <div>
                <p class="text-sm font-semibold text-body">Sign Out / Disconnect</p>
                <p class="text-xs text-body-muted">Block signing out the device while locked.</p>
              </div>
              <input
                v-model="actions.signOut"
                type="checkbox"
                class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
              />
            </label>
          </div>
        </div>

        <!-- Launch & Display Preferences -->
        <div class="space-y-3 border-t border-surface-border pt-4">
          <h4 class="text-xs font-bold uppercase tracking-wider text-body-muted">Preferences</h4>

          <label
            class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-surface-border p-3 transition hover:border-primary/30 active:bg-surface-muted"
          >
            <div>
              <p class="text-sm font-semibold text-body">Auto-lock on App Launch</p>
              <p class="text-xs text-body-muted">
                Always start the station locked upon page refresh or reboot.
              </p>
            </div>
            <input
              v-model="autoLock"
              type="checkbox"
              class="mt-1 h-4 w-4 rounded text-primary focus:ring-primary/40"
            />
          </label>

          <div>
            <label class="mb-1 block text-xs font-semibold text-body"
              >Locked Controls Appearance</label
            >
            <select
              v-model="displayMode"
              class="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="badge">Show Lock Badge (Clicking prompts PIN unlock)</option>
              <option value="hide">Hide Protected Controls</option>
              <option value="disable">Disable / Gray Out Controls</option>
            </select>
          </div>
        </div>

        <p v-if="error" role="alert" class="text-xs font-semibold text-danger">{{ error }}</p>
      </div>

      <!-- Action Buttons Footer -->
      <div
        class="flex flex-col-reverse items-stretch justify-between gap-2 border-t border-surface-border px-5 py-4 sm:flex-row sm:items-center sm:px-6"
      >
        <StandardButton
          v-if="stationLock.isEnabled"
          type="button"
          text="Disable Lock"
          variant="danger"
          size="sm"
          class="min-h-[40px]"
          :disabled="isSaving"
          @click="removePinLock"
        />
        <div v-else />

        <div class="flex gap-2">
          <StandardButton
            type="button"
            text="Cancel"
            variant="white"
            size="sm"
            class="min-h-[40px] flex-1 sm:flex-initial"
            :disabled="isSaving"
            @click="emit('close')"
          />
          <StandardButton
            type="button"
            :text="
              isSaving ? 'Saving…' : stationLock.isEnabled ? 'Update Settings' : 'Enable PIN Lock'
            "
            variant="primary"
            size="sm"
            class="min-h-[40px] flex-1 sm:flex-initial"
            :disabled="isSaving || (!stationLock.isEnabled && (!pin.trim() || pin.length < 4))"
            @click="savePinSettings"
          />
        </div>
      </div>
    </div>
  </div>
</template>

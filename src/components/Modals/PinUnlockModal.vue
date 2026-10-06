<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LockClosedIcon, KeyIcon, BackspaceIcon } from '@heroicons/vue/24/outline'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useStationLockStore } from '@/stores/stationLock'

const props = defineProps({
  show: {
    type: Boolean,
    default: true
  },
  title: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'unlocked', 'reset-pin'])

const { t } = useI18n()
const stationLock = useStationLockStore()

const modalTitle = computed(() => props.title || t('stationLock.unlock_station'))
const modalDescription = computed(() => props.description || t('stationLock.unlock_station_description'))

const pin = ref('')
const error = ref('')
const isVerifying = ref(false)
const showTokenFallback = ref(false)
const setupToken = ref('')
const tokenError = ref('')
const isVerifyingToken = ref(false)

const hiddenPinInput = ref(null)
const tokenInput = ref(null)
const countdownTimer = ref(null)
const remainingCooldown = ref(0)

const expectedPinLength = computed(() => {
  return stationLock.pinLength || 4
})

const isLockedOut = computed(() => stationLock.isLockoutActive || remainingCooldown.value > 0)

function updateCooldown() {
  remainingCooldown.value = stationLock.remainingLockoutSeconds
  if (remainingCooldown.value <= 0 && countdownTimer.value) {
    clearInterval(countdownTimer.value)
    countdownTimer.value = null
  }
}

watch(
  () => stationLock.lockoutUntil,
  () => {
    updateCooldown()
    if (stationLock.isLockoutActive && !countdownTimer.value) {
      countdownTimer.value = setInterval(updateCooldown, 1000)
    }
  },
  { immediate: true }
)

watch(
  () => props.show,
  (isShown) => {
    if (isShown) {
      void focusInput()
    }
  }
)

watch(
  () => showTokenFallback.value,
  (isFallback) => {
    if (isFallback) {
      void nextTick(() => tokenInput.value?.focus())
    } else {
      void focusInput()
    }
  }
)

async function focusInput() {
  await nextTick()
  if (!showTokenFallback.value && hiddenPinInput.value) {
    hiddenPinInput.value.focus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  if (stationLock.isLockoutActive) {
    countdownTimer.value = setInterval(updateCooldown, 1000)
  }
  void focusInput()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value)
  }
})

function handleKeydown(event) {
  if (!props.show || showTokenFallback.value) {
    return
  }

  // Handle hardware keyboard number keys and numpad
  if (event.key >= '0' && event.key <= '9') {
    appendDigit(event.key)
    event.preventDefault()
  } else if (event.key === 'Backspace') {
    deleteDigit()
    event.preventDefault()
  } else if (event.key === 'Enter') {
    if (pin.value.length >= expectedPinLength.value) {
      void submitPin()
    }
    event.preventDefault()
  } else if (event.key === 'Escape') {
    emit('close')
    event.preventDefault()
  }
}

function handleDirectInputChange(event) {
  const val = event.target.value.replace(/\D/g, '').slice(0, expectedPinLength.value)
  pin.value = val
  error.value = ''
  if (val.length === expectedPinLength.value) {
    void submitPin()
  }
}

function appendDigit(digit) {
  if (isLockedOut.value || isVerifying.value || pin.value.length >= expectedPinLength.value) {
    return
  }
  error.value = ''
  pin.value += String(digit)
  if (pin.value.length === expectedPinLength.value) {
    void submitPin()
  }
}

function deleteDigit() {
  if (isLockedOut.value || isVerifying.value) {
    return
  }
  error.value = ''
  pin.value = pin.value.slice(0, -1)
}

function clearPin() {
  pin.value = ''
  error.value = ''
  void focusInput()
}

async function submitPin() {
  if (pin.value.length < expectedPinLength.value || isLockedOut.value || isVerifying.value) {
    return
  }

  isVerifying.value = true
  error.value = ''

  try {
    const result = await stationLock.verifyPin(pin.value)
    if (result.success) {
      pin.value = ''
      emit('unlocked')
      emit('close')
    } else if (result.error === 'locked_out') {
      error.value = t('stationLock.too_many_attempts', { seconds: result.remainingSeconds })
      pin.value = ''
    } else if (result.error === 'incorrect_pin') {
      if (result.lockoutSeconds > 0) {
        error.value = t('stationLock.incorrect_pin_cooldown', { seconds: result.lockoutSeconds })
      } else {
        const remainingAttempts = 3 - result.failedAttempts
        error.value = remainingAttempts > 0
          ? t('stationLock.incorrect_pin_remaining', { attempts: remainingAttempts })
          : t('stationLock.incorrect_pin')
      }
      pin.value = ''
    } else {
      error.value = t('stationLock.failed_verify_pin')
      pin.value = ''
    }
  } catch (err) {
    console.error('PIN verification error:', err)
    error.value = t('stationLock.failed_verify_pin')
    pin.value = ''
  } finally {
    isVerifying.value = false
    void focusInput()
  }
}

async function submitTokenFallback() {
  const token = setupToken.value.trim()
  if (!token) {
    tokenError.value = t('configure.error_enter_token')
    return
  }

  isVerifyingToken.value = true
  tokenError.value = ''

  try {
    const result = await stationLock.unlockWithSetupToken(token)
    if (result.success) {
      setupToken.value = ''
      showTokenFallback.value = false
      emit('unlocked')
      emit('reset-pin')
      emit('close')
    } else {
      tokenError.value = result.message || t('configure.error_verify_failed')
    }
  } catch (err) {
    console.error('Setup token verification error:', err)
    tokenError.value = t('configure.error_verify_failed')
  } finally {
    isVerifyingToken.value = false
  }
}
</script>

<template>
  <div
    v-if="show"
    role="dialog"
    aria-modal="true"
    :aria-label="modalTitle"
    class="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
  >
    <div
      class="card animate-in fade-in zoom-in-95 flex w-full max-w-sm select-none flex-col overflow-hidden shadow-2xl duration-150 sm:max-w-md"
    >
      <!-- Hidden Accessible Input for Non-Touch Keyboards / Barcode Scanners / Password Managers -->
      <input
        ref="hiddenPinInput"
        type="password"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        :value="pin"
        class="sr-only"
        aria-hidden="true"
        tabindex="-1"
        :disabled="isLockedOut || isVerifying || showTokenFallback"
        @input="handleDirectInputChange"
        @keyup.enter="submitPin"
      />

      <!-- Header -->
      <div class="border-b border-surface-border px-6 py-4 text-center">
        <div
          class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          <LockClosedIcon v-if="!showTokenFallback" class="h-6 w-6" />
          <KeyIcon v-else class="h-6 w-6 text-warning" />
        </div>
        <h3 class="text-lg font-bold text-body">
          {{ showTokenFallback ? t('stationLock.master_setup_token') : modalTitle }}
        </h3>
        <p class="mt-1 text-xs text-body-muted">
          {{
            showTokenFallback
              ? t('stationLock.master_token_description')
              : modalDescription
          }}
        </p>
      </div>

      <!-- Main PIN Keypad View -->
      <div v-if="!showTokenFallback" class="space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <!-- Lockout Warning Banner -->
        <div
          v-if="isLockedOut"
          role="alert"
          class="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-center text-xs font-semibold text-danger sm:text-sm"
        >
          {{ t('stationLock.locked_out_cooldown', { seconds: remainingCooldown }) }}
        </div>

        <!-- PIN Dots Display (Clicking focuses hidden input for hardware keyboards) -->
        <div
          class="flex cursor-pointer items-center justify-center gap-3 py-2"
          @click="focusInput"
        >
          <div
            v-for="index in expectedPinLength"
            :key="index"
            class="flex h-4 w-4 items-center justify-center rounded-full border transition-all duration-150"
            :class="[
              index <= pin.length
                ? 'scale-110 border-primary bg-primary shadow-sm'
                : 'border-surface-border bg-surface-muted'
            ]"
          />
        </div>

        <!-- Error Message -->
        <p v-if="error" role="alert" class="text-center text-xs font-semibold text-danger">
          {{ error }}
        </p>

        <!-- Touch Numeric Keypad (Optimized for both touchscreens and pointer/mouse devices) -->
        <div class="grid touch-manipulation grid-cols-3 gap-2 pt-1 sm:gap-2.5">
          <button
            v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']"
            :key="digit"
            type="button"
            class="sm:h-13 flex h-12 min-h-[48px] items-center justify-center rounded-xl border border-surface-border bg-surface text-lg font-bold text-body shadow-sm transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95 active:bg-surface-muted disabled:pointer-events-none disabled:opacity-40 sm:text-xl"
            :disabled="isLockedOut || isVerifying"
            @click="appendDigit(digit)"
          >
            {{ digit }}
          </button>

          <!-- Clear Button -->
          <button
            type="button"
            class="sm:h-13 flex h-12 min-h-[48px] items-center justify-center rounded-xl border border-surface-border bg-surface text-xs font-semibold text-body-muted transition hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95 active:bg-surface-muted disabled:pointer-events-none disabled:opacity-40 sm:text-sm"
            :disabled="isLockedOut || isVerifying || pin.length === 0"
            @click="clearPin"
          >
            {{ t('common.clear') }}
          </button>

          <!-- Zero Button -->
          <button
            type="button"
            class="sm:h-13 flex h-12 min-h-[48px] items-center justify-center rounded-xl border border-surface-border bg-surface text-lg font-bold text-body shadow-sm transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95 active:bg-surface-muted disabled:pointer-events-none disabled:opacity-40 sm:text-xl"
            :disabled="isLockedOut || isVerifying"
            @click="appendDigit('0')"
          >
            0
          </button>

          <!-- Backspace Button -->
          <button
            type="button"
            :aria-label="t('common.delete')"
            class="sm:h-13 flex h-12 min-h-[48px] items-center justify-center rounded-xl border border-surface-border bg-surface text-body transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95 active:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
            :disabled="isLockedOut || isVerifying || pin.length === 0"
            @click="deleteDigit"
          >
            <BackspaceIcon class="h-6 w-6" />
          </button>
        </div>

        <!-- Submit Button -->
        <StandardButton
          type="button"
          :text="isVerifying ? t('stationLock.verifying') : t('stationLock.unlock')"
          variant="primary"
          block
          class="min-h-[44px]"
          :disabled="pin.length < expectedPinLength || isLockedOut || isVerifying"
          @click="submitPin"
        />

        <!-- Fallback to Setup Token -->
        <div class="pt-1 text-center">
          <button
            type="button"
            class="rounded-lg px-2 py-1 text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            @click="showTokenFallback = true"
          >
            {{ t('stationLock.forgot_pin') }}
          </button>
        </div>
      </div>

      <!-- Master Setup Token Fallback View -->
      <div v-else class="space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <div>
          <label class="section-title mb-2 block">{{ t('stationLock.organizer_setup_token') }}</label>
          <input
            ref="tokenInput"
            v-model="setupToken"
            type="password"
            autocomplete="off"
            :placeholder="t('stationLock.token_placeholder')"
            class="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            :disabled="isVerifyingToken"
            @keyup.enter="submitTokenFallback"
          />
        </div>
        <p class="text-xs text-body-muted">
          {{ t('stationLock.token_description') }}
        </p>

        <p v-if="tokenError" role="alert" class="text-xs font-semibold text-danger">
          {{ tokenError }}
        </p>

        <div class="flex flex-col gap-2 sm:flex-row">
          <StandardButton
            type="button"
            :text="t('stationLock.back_to_pin')"
            variant="white"
            class="min-h-[44px] flex-1"
            :disabled="isVerifyingToken"
            @click="showTokenFallback = false"
          />
          <StandardButton
            type="button"
            :text="isVerifyingToken ? t('stationLock.verifying') : t('stationLock.unlock_and_reset')"
            variant="warning"
            class="min-h-[44px] flex-1"
            :disabled="!setupToken.trim() || isVerifyingToken"
            @click="submitTokenFallback"
          />
        </div>
      </div>

      <!-- Footer Cancel -->
      <div class="border-t border-surface-border bg-surface-muted px-6 py-3 text-center">
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-xs font-semibold text-body-muted transition hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          @click="emit('close')"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

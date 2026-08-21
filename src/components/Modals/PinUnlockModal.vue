<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
    default: 'Unlock Station'
  },
  description: {
    type: String,
    default: 'Enter your 4–6 digit station PIN to unlock privileged actions.'
  }
})

const emit = defineEmits(['close', 'unlocked', 'reset-pin'])

const stationLock = useStationLockStore()

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
    if (pin.value.length >= 4) {
      void submitPin()
    }
    event.preventDefault()
  } else if (event.key === 'Escape') {
    emit('close')
    event.preventDefault()
  }
}

function handleDirectInputChange(event) {
  const val = event.target.value.replace(/\D/g, '').slice(0, 6)
  pin.value = val
  error.value = ''
  if (val.length === 6) {
    void submitPin()
  }
}

function appendDigit(digit) {
  if (isLockedOut.value || isVerifying.value || pin.value.length >= 6) {
    return
  }
  error.value = ''
  pin.value += String(digit)
  if (pin.value.length >= 4 && pin.value.length === 6) {
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
  if (pin.value.length < 4 || isLockedOut.value || isVerifying.value) {
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
      error.value = `Too many failed attempts. Try again in ${result.remainingSeconds}s.`
      pin.value = ''
    } else if (result.error === 'incorrect_pin') {
      if (result.lockoutSeconds > 0) {
        error.value = `Incorrect PIN. Station locked for ${result.lockoutSeconds}s.`
      } else {
        const remainingAttempts = 3 - result.failedAttempts
        error.value = `Incorrect PIN.${remainingAttempts > 0 ? ` (${remainingAttempts} attempts remaining)` : ''}`
      }
      pin.value = ''
    } else {
      error.value = 'Failed to verify PIN. Try again.'
      pin.value = ''
    }
  } catch (err) {
    console.error('PIN verification error:', err)
    error.value = 'An error occurred during verification.'
    pin.value = ''
  } finally {
    isVerifying.value = false
    void focusInput()
  }
}

async function submitTokenFallback() {
  const token = setupToken.value.trim()
  if (!token) {
    tokenError.value = 'Enter the organizer device setup token.'
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
      tokenError.value = result.message || 'Invalid setup token. Check organizer dashboard.'
    }
  } catch (err) {
    console.error('Setup token verification error:', err)
    tokenError.value = 'Could not verify token. Try again.'
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
    :aria-label="title"
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
          {{ showTokenFallback ? 'Master Setup Token' : title }}
        </h3>
        <p class="mt-1 text-xs text-body-muted">
          {{
            showTokenFallback
              ? 'Enter the device setup token from your dashboard to unlock and reset PIN.'
              : description
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
          Locked out: Retry in {{ remainingCooldown }}s
        </div>

        <!-- PIN Dots Display (Clicking focuses hidden input for hardware keyboards) -->
        <div
          class="flex cursor-pointer items-center justify-center gap-3 py-2"
          title="Click to focus keyboard"
          @click="focusInput"
        >
          <div
            v-for="index in 6"
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
            Clear
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
            aria-label="Delete digit"
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
          :text="isVerifying ? 'Verifying…' : 'Unlock'"
          variant="primary"
          block
          class="min-h-[44px]"
          :disabled="pin.length < 4 || isLockedOut || isVerifying"
          @click="submitPin"
        />

        <!-- Fallback to Setup Token -->
        <div class="pt-1 text-center">
          <button
            type="button"
            class="rounded-lg px-2 py-1 text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            @click="showTokenFallback = true"
          >
            Forgot PIN or Locked Out?
          </button>
        </div>
      </div>

      <!-- Master Setup Token Fallback View -->
      <div v-else class="space-y-4 px-5 py-4 sm:px-6 sm:py-5">
        <div>
          <label class="section-title mb-2 block">Organizer Setup Token</label>
          <input
            ref="tokenInput"
            v-model="setupToken"
            type="password"
            autocomplete="off"
            placeholder="Paste or type setup token"
            class="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-sm text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            :disabled="isVerifyingToken"
            @keyup.enter="submitTokenFallback"
          />
        </div>
        <p class="text-xs text-body-muted">
          Entering the setup token bypasses the lock timer and immediately unlocks the station so
          you can reset the PIN.
        </p>

        <p v-if="tokenError" role="alert" class="text-xs font-semibold text-danger">
          {{ tokenError }}
        </p>

        <div class="flex flex-col gap-2 sm:flex-row">
          <StandardButton
            type="button"
            text="Back to PIN"
            variant="white"
            class="min-h-[44px] flex-1"
            :disabled="isVerifyingToken"
            @click="showTokenFallback = false"
          />
          <StandardButton
            type="button"
            :text="isVerifyingToken ? 'Verifying…' : 'Unlock & Reset'"
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
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

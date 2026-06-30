<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { PencilSquareIcon, XMarkIcon } from '@heroicons/vue/20/solid'
import StandardButton from '@/components/Common/StandardButton.vue'
import { normalizeDisplayPopupFields, questionLabelForField, readPopupFieldValue } from '@/utils/attendeeEdit'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  showSuccess: {
    type: Boolean,
    default: false
  },
  showError: {
    type: Boolean,
    default: false
  },
  badgeUrl: {
    type: String,
    default: ''
  },
  productName: {
    type: String,
    default: ''
  },
  isGeneratingBadge: {
    type: Boolean,
    default: false
  },
  paused: {
    type: Boolean,
    default: false
  },
  badgeStation: {
    type: Boolean,
    default: false
  },
  autoDismiss: {
    type: Boolean,
    default: false
  },
  autoPrintEnabled: {
    type: Boolean,
    default: false
  },
  duration: {
    type: Number,
    default: 10
  },
  displayFields: {
    type: Array,
    default: () => []
  },
  questionLabels: {
    type: Object,
    default: () => ({})
  }
})

const POPUP_FIELD_LABELS = {
  company: 'Company',
  job_title: 'Job title',
  attendee_email: 'Email',
  seat: 'Seat'
}

const popupExtraRows = computed(() => {
  if (!props.showSuccess || !props.message) {
    return []
  }

  return normalizeDisplayPopupFields(props.displayFields || [])
    .map((key) => {
      const value = readPopupFieldValue(key, props.message)
      if (!value) {
        return null
      }

      return {
        label: questionLabelForField(key, {}, props.questionLabels) || POPUP_FIELD_LABELS[key] || 'Field',
        value
      }
    })
    .filter(Boolean)
})

const canCustomizeBadge = computed(
  () =>
    props.showSuccess &&
    Boolean(props.badgeUrl) &&
    props.message?.badge_customization?.allow_customization &&
    (props.message?.badge_customization?.fields || []).length > 0
)

const emit = defineEmits(['print', 'preview', 'edit', 'close', 'timeout', 'interact', 'exit', 'checkin', 'customize-badge'])

const effectiveDuration = computed(() => props.duration)

const showCountdown = computed(() => !countdownHidden.value && !props.paused && props.duration > 0)

const countdownLabel = computed(() => `Auto-close in ${countdown.value}`)

const showEcoReminder = computed(
  () => props.badgeStation && props.showSuccess && Boolean(props.message?.alreadyCheckedIn)
)

const paperSavingMessage = computed(
  () => 'Help us save paper — please reprint badges only when explicitly needed. Thank you.'
)

const resultLabel = computed(() => {
  if (props.showError) {
    if (props.message?.checkoutRequired) {
      return 'Check-out required'
    }
    return props.badgeStation ? 'Badge issue' : 'Check-in issue'
  }
  if (props.message?.offerCheckInAtGate) {
    return 'Check-in available'
  }
  if (props.message?.checkedOut) {
    return 'Checked out'
  }
  return props.badgeStation ? 'Badge station' : 'Check-in result'
})

const isCheckedOutResult = computed(() => Boolean(props.message?.checkedOut))

const resultToneClass = computed(() => {
  if (props.showError || isCheckedOutResult.value) {
    return 'text-danger'
  }
  return 'text-success'
})

const countdown = ref(effectiveDuration.value)
const countdownHidden = ref(false)
let timer = null

function startTimer() {
  stopTimer()
  countdown.value = effectiveDuration.value
  timer = setInterval(() => {
    if (props.paused) {
      return
    }
    countdown.value -= 1
    if (countdown.value <= 0) {
      stopTimer()
      emit('timeout')
    }
  }, 1000)
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function handleInteract(eventName) {
  countdownHidden.value = true
  emit('interact')
  emit(eventName)
}

function handlePreviewClick() {
  handleInteract('preview')
}

function handlePrintClick() {
  handleInteract('print')
}

function handleEditClick() {
  handleInteract('edit')
}

function handleExitClick() {
  stopTimer()
  emit('exit')
}

function handleCheckInClick() {
  stopTimer()
  emit('checkin')
}

function handleCustomizeBadgeClick() {
  handleInteract('customize-badge')
}

function handleCloseClick() {
  stopTimer()
  handleInteract('close')
}

watch(
  () => props.paused,
  (isPaused) => {
    if (isPaused) {
      stopTimer()
    } else if (props.showSuccess || props.showError) {
      startTimer()
    }
  }
)

watch(
  () => [props.showSuccess, props.showError, props.message, props.duration, props.autoDismiss],
  () => {
    if (props.showSuccess || props.showError) {
      countdownHidden.value = false
      if (props.autoDismiss) {
        startTimer()
      } else {
        stopTimer()
      }
    } else {
      stopTimer()
    }
  },
  { immediate: true, deep: true }
)

onBeforeUnmount(() => {
  stopTimer()
})
</script>

<template>
  <Transition name="modal">
    <div
      v-if="(showSuccess || showError) && message"
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
            @click="handleCloseClick"
          >
            <XMarkIcon class="h-7 w-7" />
          </button>
        </div>

        <p
          class="mb-1 text-xs font-semibold uppercase tracking-wide"
          :class="resultToneClass"
        >
          {{ resultLabel }}
        </p>
        <h2 class="mb-4 text-xl" :class="resultToneClass">
          {{ message.message }}
        </h2>

        <dl v-if="showSuccess || message?.checkoutRequired || message?.offerCheckInAtGate || message?.checkedOut" class="space-y-2 border-t border-surface-border pt-4 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-body-muted">Name</dt>
            <dd class="text-right font-medium text-body">
              {{ message.attendee_name || message.attendee }}
            </dd>
          </div>
          <div v-if="productName" class="flex justify-between gap-4">
            <dt class="text-body-muted">Ticket</dt>
            <dd class="text-right text-body">{{ productName }}</dd>
          </div>
          <div
            v-for="row in popupExtraRows"
            :key="row.label"
            class="flex justify-between gap-4"
          >
            <dt class="text-body-muted">{{ row.label }}</dt>
            <dd class="text-right text-body">{{ row.value }}</dd>
          </div>
        </dl>

        <p
          v-if="badgeStation && showSuccess && !badgeUrl"
          class="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-dark"
        >
          No badge download is available. Enable the Badges plugin and configure a badge layout for
          this event.
        </p>

        <p
          v-else-if="badgeStation && showSuccess && isGeneratingBadge"
          class="mt-4 text-center text-sm text-body-muted"
        >
          Preparing badge for printing...
        </p>

        <div
          v-if="showEcoReminder"
          class="mt-4 flex items-start gap-2.5 rounded-lg border border-success/20 bg-success/5 px-3 py-2.5"
        >
          <svg
            class="mt-0.5 h-4 w-4 shrink-0 text-success"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
          </svg>
          <p class="text-xs leading-relaxed text-success-dark/90">
            {{ paperSavingMessage }}
          </p>
        </div>

        <div class="mt-6 space-y-2">
          <StandardButton
            v-if="showSuccess && !message?.checkedOut && !message?.offerCheckInAtGate"
            type="button"
            text="Check out"
            variant="white"
            block
            @click="handleExitClick"
          />
          <StandardButton
            v-else-if="message?.checkoutRequired"
            type="button"
            text="Confirm checkout"
            variant="primary"
            block
            @click="handleExitClick"
          />
          <template v-else-if="message?.offerCheckInAtGate">
            <StandardButton
              type="button"
              text="Check in"
              variant="primary"
              block
              @click="handleCheckInClick"
            />
            <StandardButton
              type="button"
              text="Not now"
              variant="white"
              block
              @click="handleCloseClick"
            />
          </template>
          <template v-if="badgeStation && badgeUrl && showSuccess">
            <StandardButton
              v-if="canCustomizeBadge"
              type="button"
              text="Customize badge"
              variant="white"
              block
              @click="handleCustomizeBadgeClick"
            />
            <StandardButton
              type="button"
              text="Print preview"
              :variant="autoPrintEnabled ? 'white' : 'primary'"
              block
              @click="handlePreviewClick"
            />
            <StandardButton
              type="button"
              :text="isGeneratingBadge ? 'Sending to printer...' : 'Print badge'"
              :disabled="isGeneratingBadge"
              :variant="autoPrintEnabled ? 'primary' : 'white'"
              block
              @click="handlePrintClick"
            />
          </template>

          <template v-else-if="badgeUrl && showSuccess">
            <StandardButton
              v-if="canCustomizeBadge"
              type="button"
              text="Customize badge"
              variant="white"
              block
              @click="handleCustomizeBadgeClick"
            />
            <StandardButton
              type="button"
              :text="isGeneratingBadge ? 'Preparing badge...' : 'Print badge'"
              :disabled="isGeneratingBadge"
              variant="primary"
              block
              @click="handlePrintClick"
            />
          </template>

          <div class="flex gap-2">
            <StandardButton
              v-if="message?.secret || message?.orderPositionId"
              type="button"
              text=""
              :icon="PencilSquareIcon"
              variant="success"
              size="sm"
              aria-label="Edit attendee details"
              @click="handleEditClick"
            />
            <StandardButton
              type="button"
              text="Done"
              variant="white"
              block
              @click="handleCloseClick"
            />
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

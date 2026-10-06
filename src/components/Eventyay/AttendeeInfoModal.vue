<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { PencilSquareIcon, XMarkIcon } from '@heroicons/vue/20/solid'
import StandardButton from '@/components/Common/StandardButton.vue'
import { normalizeDisplayPopupFields, questionLabelForField, readPopupFieldValue } from '@/utils/attendeeEdit'

const { t } = useI18n()

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
  job_title: 'Job title'
}

function formatDateTime(value) {
  if (!value) {
    return ''
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return String(value)
  }
  return parsed.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function getInvalidTimeKind(message) {
  const now = Date.now()
  const validFrom = message?.admission_valid_from
  const validUntil = message?.admission_valid_until

  if (validFrom) {
    const fromMs = new Date(validFrom).getTime()
    if (!Number.isNaN(fromMs) && fromMs > now) {
      return 'not_yet'
    }
  }
  if (validUntil) {
    const untilMs = new Date(validUntil).getTime()
    if (!Number.isNaN(untilMs) && untilMs < now) {
      return 'expired'
    }
  }

  const detail = String(message?.message || '').toLowerCase()
  if (detail.includes('not valid yet')) {
    return 'not_yet'
  }
  if (detail.includes('no longer valid')) {
    return 'expired'
  }
  return null
}

const validityDisplayText = computed(() => {
  const windowText = String(props.message?.validityWindow || '').trim()
  if (windowText) {
    return windowText
  }

  const validFrom = props.message?.admission_valid_from
  const validUntil = props.message?.admission_valid_until
  if (!validFrom && !validUntil) {
    return ''
  }

  const fromLabel = formatDateTime(validFrom)
  const untilLabel = formatDateTime(validUntil)
  if (fromLabel && untilLabel) {
    return `${fromLabel} – ${untilLabel}`
  }
  return fromLabel || untilLabel
})

const hasAttendeeIdentity = computed(() => {
  if (props.message?.orderPositionId) {
    return true
  }
  if (String(props.message?.attendee_name || '').trim()) {
    return true
  }
  return Boolean(String(props.message?.attendee || '').trim())
})

const isSimpleError = computed(
  () => Boolean(props.message?.simpleError) || (props.showError && !hasAttendeeIdentity.value)
)

const showAttendeeDetails = computed(() => {
  if (isSimpleError.value) {
    return false
  }
  return (
    props.showSuccess ||
    props.message?.checkoutRequired ||
    props.message?.offerCheckInAtGate ||
    props.message?.checkedOut ||
    Boolean(props.message?.alreadyCheckedIn) ||
    (props.showError &&
      Boolean(props.message?.attendee_name || props.message?.attendee || props.message?.orderPositionId))
  )
})

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

const emit = defineEmits(['print', 'preview', 'edit', 'edit-badge', 'close', 'timeout', 'interact', 'exit', 'checkin', 'checkout-confirm'])

const effectiveDuration = computed(() => props.duration)

const showCountdown = computed(
  () =>
    !suppressAutoClose.value &&
    !countdownHidden.value &&
    !props.paused &&
    props.duration > 0 &&
    countdown.value > 0
)

const countdownLabel = computed(() => {
  const seconds = Number(countdown.value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return ''
  }
  return t('attendee.closing_in', { seconds })
})

const showEcoReminder = computed(
  () => props.badgeStation && props.showSuccess && Boolean(props.message?.alreadyCheckedIn)
)

const paperSavingMessage = computed(
  () => t('attendee.eco_reminder')
)

const resultLabel = computed(() => {
  if (props.message?.alreadyCheckedIn) {
    return t('attendee.already_checked_in')
  }
  if (props.showError) {
    if (props.message?.errorLabel) {
      return props.message.errorLabel
    }
    if (props.message?.checkoutRequired) {
      return t('attendee.checkout_required')
    }
    if (props.message?.errorReason === 'invalid_time') {
      const kind = getInvalidTimeKind(props.message)
      if (kind === 'not_yet') {
        return t('attendee.ticket_not_yet_valid')
      }
      if (kind === 'expired') {
        return t('attendee.ticket_expired')
      }
      return t('attendee.ticket_not_valid')
    }
    if (props.message?.errorReason === 'invalid') {
      return t('attendee.ticket_not_found')
    }
    if (props.message?.errorReason === 'product') {
      return t('attendee.wrong_checkin_list')
    }
    if (props.message?.errorReason === 'subevent') {
      return t('attendee.wrong_date_session')
    }
    if (props.message?.errorReason === 'unpaid') {
      return t('attendee.payment_required')
    }
    if (props.message?.errorReason === 'rules') {
      return t('attendee.checkin_blocked')
    }
    if (props.message?.errorReason === 'canceled' || props.message?.positionCanceled || props.message?.orderCanceled) {
      if (props.message?.orderCanceled) {
        return t('attendee.order_canceled')
      }
      return t('attendee.ticket_canceled')
    }
    return props.badgeStation ? t('attendee.badge_issue') : t('attendee.checkin_issue')
  }
  if (props.message?.offerCheckInAtGate) {
    return t('attendee.checkin_available')
  }
  if (props.message?.checkedOut) {
    return t('attendee.checked_out')
  }
  if (props.showSuccess) {
    const detail = String(props.message?.message || '').trim()
    if (detail) {
      return detail
    }
    return t('attendee.checkin_success')
  }
  return props.badgeStation ? t('checkin.badge_station') : t('checkin.check_in')
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

const modalHelperText = computed(() => {
  if (isSimpleError.value) {
    return ''
  }

  if (props.message?.checkoutRequired) {
    return String(props.message?.message || '').trim()
  }

  if (props.message?.errorReason === 'invalid_time' && validityDisplayText.value) {
    return ''
  }

  const submessage = String(props.message?.submessage || '').trim()
  if (submessage) {
    return submessage
  }

  const label = resultLabel.value
  const detail = String(props.message?.message || '').trim()

  if (!detail || detailRepeatsLabel(label, detail)) {
    return ''
  }

  return detail
})

const isAlreadyCheckedIn = computed(() => Boolean(props.message?.alreadyCheckedIn))

const isCheckedOutResult = computed(() => Boolean(props.message?.checkedOut))

const canCheckOut = computed(
  () =>
    (props.showSuccess || isAlreadyCheckedIn.value) &&
    !props.message?.checkedOut &&
    !props.message?.checkoutRequired &&
    !props.message?.offerCheckInAtGate
)

const isCheckoutFlow = computed(
  () =>
    Boolean(props.message?.checkoutRequired) ||
    Boolean(props.message?.offerCheckInAtGate)
)

const showCheckoutConfirm = ref(false)

const suppressAutoClose = computed(
  () => isCheckoutFlow.value || showCheckoutConfirm.value
)

const canShowBadgeActions = computed(
  () =>
    Boolean(props.badgeUrl) &&
    (props.showSuccess || isAlreadyCheckedIn.value) &&
    !props.message?.checkedOut
)

const canEditAttendee = computed(
  () =>
    !props.badgeStation &&
    (props.showSuccess || isAlreadyCheckedIn.value) &&
    !props.showError &&
    !props.message?.checkedOut &&
    !props.message?.checkoutRequired &&
    !props.message?.offerCheckInAtGate &&
    Boolean(props.message?.secret || props.message?.orderPositionId)
)

const canEditBadge = computed(
  () =>
    props.badgeStation &&
    canShowBadgeActions.value &&
    Boolean(props.message?.badge_customization?.allow_customization) &&
    Boolean(props.message?.badge_customization?.fields?.length)
)

const resultToneClass = computed(() => {
  if (props.message?.checkoutRequired) {
    return 'text-danger'
  }
  if (isAlreadyCheckedIn.value) {
    return 'text-success'
  }
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
  stopTimer()
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

function handleEditBadgeClick() {
  handleInteract('edit-badge')
}

function handleExitClick() {
  stopTimer()
  showCheckoutConfirm.value = true
  emit('checkout-confirm', true)
}

function confirmCheckout() {
  showCheckoutConfirm.value = false
  emit('checkout-confirm', false)
  emit('exit')
}

function cancelCheckout() {
  showCheckoutConfirm.value = false
  emit('checkout-confirm', false)
}

function handleCheckInClick() {
  stopTimer()
  emit('checkin')
}

function handleCloseClick() {
  stopTimer()
  handleInteract('close')
}

watch(
  () => props.showSuccess || props.showError,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      countdownHidden.value = false
    }
  }
)

watch(
  () => props.paused,
  (isPaused) => {
    if (isPaused || suppressAutoClose.value) {
      stopTimer()
    } else if ((props.showSuccess || props.showError) && props.duration > 0) {
      startTimer()
    }
  }
)

watch(
  () => [props.showSuccess, props.showError, props.duration, props.paused, suppressAutoClose],
  () => {
    if (props.showSuccess || props.showError) {
      if (!props.paused && !suppressAutoClose.value && props.duration > 0) {
        startTimer()
      } else {
        stopTimer()
      }
    } else {
      countdownHidden.value = false
      showCheckoutConfirm.value = false
      stopTimer()
    }
  },
  { immediate: true }
)

const checkoutConfirmTitle = computed(() => {
  const name = props.message?.attendee_name || props.message?.attendee
  if (props.message?.checkoutRequired) {
    return t('attendee.checkout_required')
  }
  return name ? t('attendee.confirm_checkout_named', { name }) : t('attendee.confirm_checkout_title')
})

const checkoutConfirmMessage = computed(() => {
  if (!props.message?.checkoutRequired) {
    return ''
  }
  const detail = String(props.message?.message || '').trim()
  return detail || t('attendee.confirm_checkout_message')
})

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
            :aria-label="t('common.close')"
            @click="handleCloseClick"
          >
            <XMarkIcon class="h-7 w-7" />
          </button>
        </div>

        <h2 class="mb-1 text-xl" :class="resultToneClass">
          {{ resultLabel }}
        </h2>
        <p v-if="modalHelperText" class="mb-4 text-sm text-body-muted">
          {{ modalHelperText }}
        </p>
        <div v-else class="mb-4" />

        <dl
          v-if="showAttendeeDetails"
          class="space-y-2 border-t border-surface-border pt-4 text-sm"
        >
          <div class="flex justify-between gap-4">
            <dt class="text-body-muted">{{ t('attendee.name') }}</dt>
            <dd class="text-right font-medium text-body">
              {{ message.attendee_name || message.attendee }}
            </dd>
          </div>
          <div v-if="productName" class="flex justify-between gap-4">
            <dt class="text-body-muted">{{ t('attendee.ticket') }}</dt>
            <dd class="text-right text-body">{{ productName }}</dd>
          </div>
          <div
            v-if="message?.positionCanceled || message?.orderCanceled || message?.errorReason === 'canceled'"
            class="flex justify-between gap-4"
          >
            <dt class="text-body-muted">{{ t('attendee.status') }}</dt>
            <dd class="text-right font-medium text-danger">{{ t('attendee.canceled') }}</dd>
          </div>
          <div v-if="validityDisplayText" class="flex justify-between gap-4">
            <dt class="text-body-muted">{{ t('attendee.valid') }}</dt>
            <dd class="text-right text-body">{{ validityDisplayText }}</dd>
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
          {{ t('attendee.no_badge_download') }}
        </p>

        <p
          v-else-if="badgeStation && showSuccess && isGeneratingBadge"
          class="mt-4 text-center text-sm text-body-muted"
        >
          {{ t('attendee.preparing_badge') }}
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
            v-if="canCheckOut"
            type="button"
            :text="t('attendee.check_out')"
            variant="danger"
            block
            @click="handleExitClick"
          />
          <StandardButton
            v-else-if="message?.checkoutRequired"
            type="button"
            :text="t('attendee.check_out')"
            variant="danger"
            block
            @click="handleExitClick"
          />
          <template v-else-if="message?.offerCheckInAtGate">
            <StandardButton
              type="button"
              :text="t('attendee.check_in')"
              variant="primary"
              block
              @click="handleCheckInClick"
            />
            <StandardButton
              type="button"
              :text="t('attendee.not_now')"
              variant="white"
              block
              @click="handleCloseClick"
            />
          </template>
          <template v-if="badgeStation && canShowBadgeActions">
            <StandardButton
              type="button"
              :text="t('attendee.print_preview')"
              :variant="autoPrintEnabled ? 'white' : 'primary'"
              block
              @click="handlePreviewClick"
            />
            <StandardButton
              type="button"
              :text="isGeneratingBadge ? t('attendee.sending_to_printer') : t('attendee.print_badge')"
              :disabled="isGeneratingBadge"
              :variant="autoPrintEnabled ? 'primary' : 'white'"
              block
              @click="handlePrintClick"
            />
          </template>

          <template v-else-if="canShowBadgeActions">
            <StandardButton
              type="button"
              :text="isGeneratingBadge ? t('attendee.preparing_badge') : t('attendee.print_badge')"
              :disabled="isGeneratingBadge"
              variant="primary"
              block
              @click="handlePrintClick"
            />
          </template>

          <div class="flex gap-2">
            <StandardButton
              v-if="canEditBadge"
              type="button"
              text=""
              :icon="PencilSquareIcon"
              variant="success"
              size="sm"
              :aria-label="t('attendee.edit_badge')"
              @click="handleEditBadgeClick"
            />
            <StandardButton
              v-if="canEditAttendee"
              type="button"
              text=""
              :icon="PencilSquareIcon"
              variant="success"
              size="sm"
              :aria-label="t('attendee.edit_attendee')"
              @click="handleEditClick"
            />
            <StandardButton
              type="button"
              :text="t('common.done')"
              variant="white"
              block
              @click="handleCloseClick"
            />
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="modal">
    <div
      v-if="showCheckoutConfirm"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
    >
      <div class="card w-full max-w-sm p-6">
        <h2 class="text-xl font-semibold text-danger">{{ checkoutConfirmTitle }}</h2>
        <p v-if="checkoutConfirmMessage" class="mt-3 text-sm text-body-muted">
          {{ checkoutConfirmMessage }}
        </p>
        <div class="mt-6 space-y-2">
          <StandardButton
            type="button"
            :text="t('attendee.check_out')"
            variant="danger"
            block
            @click="confirmCheckout"
          />
          <StandardButton
            type="button"
            :text="t('common.cancel')"
            variant="white"
            block
            @click="cancelCheckout"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

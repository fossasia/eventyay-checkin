<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { apiV1Path, createAuthorizedDeviceApi, normalizeApiResourcePath } from '@/utils/serverUrl'
import {
  buildAttendeePatchPayload,
  buildEditableAttendeeState,
  getAttendeeEditFieldKeys,
  indexQuestionsById,
  normalizeDisplayPopupFields,
  questionIdFromFieldKey,
  questionLabelForField,
  readPopupFieldValue
} from '@/utils/attendeeEdit'
import { getDeviceErrorMessage, handleDeviceApiError, isDeviceProfileDenied } from '@/utils/deviceErrors'
import { MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import QRCamera from '@/components/Common/QRCamera.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import BadgePrintPreview from '@/components/Common/BadgePrintPreview.vue'
import AttendeeInfoModal from '@/components/Eventyay/AttendeeInfoModal.vue'
import BadgeCustomizeModal from '@/components/Eventyay/BadgeCustomizeModal.vue'
import { useCheckinSettingsStore } from '@/stores/checkinSettings'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useEventyayEventStore } from '@/stores/eventyayEvent'
import { useLiveRegistrationStore } from '@/stores/liveRegistration'
import { useLoadingStore } from '@/stores/loading'
import { useNotificationStore } from '@/stores/notification'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { useCameraStore } from '@/stores/camera'
import { isBadgeCustomizationUnchanged } from '@/utils/badgeCustomization'
import { downloadPdfBlob, fetchBadgePdfWithRetry, printPdfBlob, PRINT_OUTCOME } from '@/utils/badgePdf'
import { waitForDesignAssets } from '@/utils/waitForDesignAssets'
import { enterKioskShell, isKioskEnvironment } from '@/utils/kioskLauncher'

const notificationStore = useNotificationStore()
const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug, selectedRole, selectedCheckInListId, gateName } = storeToRefs(processApi)
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const checkinSettings = useCheckinSettingsStore()
const { autoPrintEnabled } = storeToRefs(checkinSettings)
const { message, showSuccess, showError, badgeUrl, isGeneratingBadge, availableCheckInLists, autoPrintFeedback, badgeCustomizeRequest, autoPrintCustomizeOnce } = storeToRefs(
  processEventyayCheckInStore
)
const {
  checkOutBySecret,
  checkInBySecret,
  showOfferCheckInMsg,
  showCanceledAttendeeFromSearch,
  buildAttendeeMessage,
  getSelectedCheckInList,
  resolveBadgeCustomization,
  cancelBadgeCustomization,
  openBadgeCustomization,
  printBadgeWithOptionalCustomization
} = processEventyayCheckInStore
const liveRegistrationStore = useLiveRegistrationStore()
const { products, isLoadingProducts, isRegistering } = storeToRefs(liveRegistrationStore)
const eventyayEventStore = useEventyayEventStore()
const { events } = storeToRefs(eventyayEventStore)
const loadingStore = useLoadingStore()
const cameraStore = useCameraStore()

const route = useRoute()
const isKioskShell = computed(() => isKioskEnvironment(route))
const checkInReady = ref(false)
const selectedCheckInListName = computed(() => {
  const list = availableCheckInLists.value.find(
    (l) => String(l.id) === String(selectedCheckInListId.value)
  )
  return list ? list.name : ''
})

function getDeviceApi() {
  return createAuthorizedDeviceApi(url.value, apitoken.value, { Accept: 'application/json' })
}

const searchQuery = ref('')
const orders = ref([])
const loading = ref(false)
const showPrintPreview = ref(false)
const badgePreviewKey = ref(0)
const isEditDialogOpen = ref(false)
const isCheckoutConfirmOpen = ref(false)
const isSavingAttendee = ref(false)
const editError = ref('')
const isBadgeStation = computed(() => selectedRole.value === 'Badge Station')
const showLiveRegistrationEntry = computed(() => {
  if (isBadgeStation.value) {
    return false
  }

  const event = events.value.find((entry) => entry.slug === eventSlug.value)
  if (!event?.plugins?.length) {
    return true
  }

  return event.plugins.includes('eventyay.plugins.manualpayment')
})
const shouldAutoPrintBadge = computed(() => isBadgeStation.value && autoPrintEnabled.value)
const attendeeModalPaused = computed(
  () =>
    isEditDialogOpen.value ||
    showPrintPreview.value ||
    isCheckoutConfirmOpen.value ||
    Boolean(badgeCustomizeRequest.value)
)

const showAttendeeModal = computed(() => {
  if (!message.value || showPrintPreview.value) {
    return false
  }
  const msg = message.value
  if (
    shouldAutoPrintBadge.value &&
    showSuccess.value &&
    !msg?.alreadyCheckedIn &&
    !msg?.manualReprintOnly &&
    !msg?.checkedOut
  ) {
    return false
  }
  return showSuccess.value || showError.value
})

const displayPopupFields = computed(() =>
  normalizeDisplayPopupFields(getSelectedCheckInList()?.display_popup_fields || [])
)
const attendeeEditFieldKeys = computed(() => getAttendeeEditFieldKeys(displayPopupFields.value))
const eventQuestions = ref([])
const questionsById = computed(() => indexQuestionsById(eventQuestions.value))
const popupQuestionLabels = computed(() => {
  const labels = {}
  for (const fieldKey of displayPopupFields.value) {
    labels[fieldKey] = questionLabelForField(fieldKey, questionsById.value)
  }
  return labels
})

const editableAttendee = ref({
  attendee_name: '',
  fields: {}
})
const originalAttendee = ref({
  attendee_name: '',
  fields: {},
  _answers: []
})
const isLiveRegistrationDialogOpen = ref(false)
const liveRegistrationResult = ref(null)
const liveRegistrationTicketError = ref('')
const isLoadingLiveRegistrationTicket = ref(false)
const liveRegistrationError = ref('')
const liveRegistrationForm = ref({
  attendee_name: '',
  attendee_email: '',
  company: '',
  job_title: '',
  product_id: ''
})

const searchCache = new Map()
const SEARCH_DEBOUNCE_MS = 300
const MIN_SEARCH_LENGTH = 2
const SEARCH_RESULTS_LIMIT = 50
let debounceTimer = null
let activeRequestId = 0

watch(eventSlug, () => {
  eventQuestions.value = []
  void ensureEventQuestionsLoaded()
})

watch(displayPopupFields, () => {
  void ensureEventQuestionsLoaded()
})

watch(selectedRole, (role) => {
  checkinSettings.syncAutoPrintForRole(role)
})

watch(autoPrintEnabled, (enabled) => {
  if (!enabled) {
    autoPrintCustomizeOnce.value = false
  }
})

watch(showAttendeeModal, (visible) => {
  if (visible) {
    cameraStore.clearLastScan()
    cameraStore.isProcessing = true
    return
  }
  if (!cameraStore.paused) {
    cameraStore.clearLastScan()
    cameraStore.isProcessing = false
  }
})

watch(
  () => ({
    success: showSuccess.value,
    orderPositionId: message.value?.orderPositionId,
    checkedOut: message.value?.checkedOut,
    alreadyCheckedIn: message.value?.alreadyCheckedIn
  }),
  ({ success, orderPositionId, checkedOut, alreadyCheckedIn }) => {
    if (!success || !orderPositionId) {
      return
    }

    const positionUpdate = {
      id: orderPositionId,
      attendee_name: message.value?.attendee_name,
      attendee_email: message.value?.attendee_email,
      company: message.value?.company,
      job_title: message.value?.job_title
    }

    if (checkedOut) {
      updateOrderInSearchResults(positionUpdate, { action: 'exit', status: 'ok' })
      return
    }

    updateOrderInSearchResults(positionUpdate, {
      action: 'entry',
      status: alreadyCheckedIn ? 'redeemed' : 'ok'
    })
  }
)


const toggleAutoPrintCustomizeOnce = () => {
  autoPrintCustomizeOnce.value = !autoPrintCustomizeOnce.value
}

const closePopup = () => {
  isEditDialogOpen.value = false
  processEventyayCheckInStore.$reset()
}

const printBadgeDirect = async () => {
  if (!badgeUrl.value) {
    return
  }
  const outcome = await processEventyayCheckInStore.printBadge(badgeUrl.value)
  if (outcome === PRINT_OUTCOME.PRINTED) {
    notificationStore.addNotification(['Success', 'Badge sent to printer'], 'success')
  } else if (outcome !== PRINT_OUTCOME.CANCELLED) {
    notificationStore.addNotification(
      ['Badge print', 'Badge is still generating or could not be printed. Try Print preview.'],
      'warning'
    )
  }
}

const openBadgePreviewFromModal = () => {
  openBadgePreview()
}

function applyBadgeCustomizationResult(customization, customizationResult) {
  if (!message.value || !customizationResult) {
    return
  }

  const hiddenFields = Array.isArray(customizationResult)
    ? customizationResult
    : customizationResult.hiddenFields
  const fieldOverrides = Array.isArray(customizationResult)
    ? customization?.field_overrides || {}
    : customizationResult.fieldOverrides || {}

  message.value = {
    ...message.value,
    badge_customization: {
      ...customization,
      hidden_fields: hiddenFields,
      field_overrides: fieldOverrides
    }
  }
  badgePreviewKey.value += 1
}

const openBadgeEditDialog = async () => {
  const customization = message.value?.badge_customization
  const positionId = message.value?.orderPositionId

  if (!customization?.allow_customization || !customization.fields?.length) {
    return
  }

  try {
    const customizationResult = await openBadgeCustomization(customization, positionId, {
      badgeUrlPath: badgeUrl.value,
      editMode: true
    })
    if (!customizationResult) {
      return
    }
    applyBadgeCustomizationResult(customization, customizationResult)
    if (!isBadgeCustomizationUnchanged(customization, customizationResult)) {
      notificationStore.addNotification(['Badge', 'Badge updated'], 'success')
    }
  } catch (error) {
    console.error('Error editing badge:', error)
    notificationStore.addNotification(['Badge', 'Unable to update badge'], 'error')
  }
}

const handleModalPrint = async () => {
  if (!badgeUrl.value) {
    return
  }
  const position = {
    id: message.value?.orderPositionId,
    badge_customization: message.value?.badge_customization
  }

  if (isBadgeStation.value) {
    const outcome = await printBadgeWithOptionalCustomization(badgeUrl.value, position, {
      customize: false
    })
    if (outcome === PRINT_OUTCOME.PRINTED && message.value?.orderPositionId) {
      processEventyayCheckInStore.markPrintedBadge(message.value.orderPositionId)
    }
    if (outcome === PRINT_OUTCOME.PRINTED) {
      notificationStore.addNotification(['Success', 'Badge sent to printer'], 'success')
    } else if (outcome !== PRINT_OUTCOME.CANCELLED) {
      notificationStore.addNotification(
        ['Badge print', 'Badge is still generating or could not be printed. Try Print preview.'],
        'warning'
      )
    }
    return
  }

  if (position.badge_customization?.allow_customization) {
    const customizationResult = await openBadgeCustomization(position.badge_customization, position.id)
    if (!customizationResult) {
      return
    }
    if (!isBadgeCustomizationUnchanged(position.badge_customization, customizationResult)) {
      applyBadgeCustomizationResult(position.badge_customization, customizationResult)
    }
  }

  openBadgePreviewFromModal()
}

const handleExitFromModal = async () => {
  const secret = message.value?.secret
  if (!secret) {
    closePopup()
    return
  }
  cameraStore.clearLastScan()
  cameraStore.isProcessing = true
  const wasCrossGate = message.value?.crossGateCheckout
  const attendeeHints = {
    attendee_name: message.value?.attendee_name,
    attendee_email: message.value?.attendee_email,
    company: message.value?.company,
    job_title: message.value?.job_title
  }
  const checkoutResponse = await checkOutBySecret(secret, {
    attendeeHints,
    suppressSuccess: wasCrossGate
  })
  if (
    checkoutResponse &&
    (checkoutResponse.status === 'ok' || checkoutResponse.status === 'redeemed') &&
    checkoutResponse.position
  ) {
    updateOrderInSearchResults(checkoutResponse.position, {
      action: 'exit',
      status: checkoutResponse.status
    })
  }
  if (
    wasCrossGate &&
    checkoutResponse &&
    (checkoutResponse.status === 'ok' || checkoutResponse.status === 'redeemed')
  ) {
    const gateLabel = gateName.value || 'this gate'
    showOfferCheckInMsg(
      buildAttendeeMessage(
        `Would you like to check in at ${gateLabel}?`,
        checkoutResponse.position,
        secret,
        attendeeHints
      )
    )
  }
}

const handleCheckInAfterCheckout = async () => {
  const secret = message.value?.secret
  if (!secret) {
    closePopup()
    return
  }
  cameraStore.clearLastScan()
  cameraStore.isProcessing = true
  const checkInResponse = await checkInBySecret(secret, {
    attendeeHints: {
      attendee_name: message.value?.attendee_name,
      attendee_email: message.value?.attendee_email,
      company: message.value?.company,
      job_title: message.value?.job_title
    }
  })
  if (
    checkInResponse &&
    (checkInResponse.status === 'ok' || checkInResponse.status === 'redeemed') &&
    checkInResponse.position
  ) {
    updateOrderInSearchResults(checkInResponse.position, {
      action: 'entry',
      status: checkInResponse.status
    })
  }
}

const openBadgePreview = () => {
  if (!badgeUrl.value) {
    return
  }
  showPrintPreview.value = true
}

const handleBadgeCustomizePreview = async (result) => {
  try {
    await processEventyayCheckInStore.previewBadgeCustomization(result)
    badgePreviewKey.value += 1
    openBadgePreview()
  } catch (error) {
    console.error('Badge preview failed:', error)
    notificationStore.addNotification(
      ['Preview failed', error?.message || 'Could not load the badge preview.'],
      'error'
    )
  }
}

const handlePrintClose = () => {
  showPrintPreview.value = false
}

const getProductEnglishName = (product) => {
  if (!product?.name) {
    return `Product ${product?.id || ''}`.trim()
  }

  if (typeof product.name === 'string') {
    return product.name
  }

  if (typeof product.name === 'object') {
    return product.name.en || Object.values(product.name)[0] || `Product ${product.id}`
  }

  return `Product ${product.id}`
}

const getProductDisplayLabel = (product) =>
  `${getProductEnglishName(product)} (${product.default_price || '0.00'})`

const getI18nString = (value) => {
  if (!value) return ''
  if (typeof value === 'object') {
    return value.en || value[Object.keys(value)[0]] || ''
  }
  return String(value)
}

const getCheckedInProductName = (productId, variationId) => {
  if (!productId) {
    return ''
  }

  const selectedProduct = products.value.find(
    (product) => String(product.id) === String(productId)
  )
  if (selectedProduct) {
    let name = getProductEnglishName(selectedProduct)
    if (variationId && selectedProduct.variations) {
      const selectedVariation = selectedProduct.variations.find(
        (v) => String(v.id) === String(variationId)
      )
      if (selectedVariation) {
        const variationValue = getI18nString(selectedVariation.value)
        if (variationValue) {
          name = `${name} (${variationValue})`
        }
      }
    }
    return name
  }

  return `Product ID ${productId}`
}

const resetLiveRegistrationForm = () => {
  liveRegistrationForm.value = {
    attendee_name: '',
    attendee_email: '',
    company: '',
    job_title: '',
    product_id: products.value.length ? String(products.value[0].id) : ''
  }
}

const openLiveRegistrationDialog = async () => {
  liveRegistrationError.value = ''
  resetLiveRegistrationForm()
  isLiveRegistrationDialogOpen.value = true

  if (!products.value.length && !isLoadingProducts.value) {
    try {
      await liveRegistrationStore.fetchProducts({ force: true })
      resetLiveRegistrationForm()
    } catch (error) {
      console.error('Error fetching products for live registration:', error)
      liveRegistrationError.value = getDeviceErrorMessage(
        error,
        'Unable to load ticket products for this event.'
      )
    }
  }
}

const closeLiveRegistrationDialog = () => {
  isLiveRegistrationDialogOpen.value = false
  liveRegistrationError.value = ''
}

const closeLiveRegistrationSuccess = () => {
  liveRegistrationResult.value = null
  liveRegistrationTicketError.value = ''
  isLoadingLiveRegistrationTicket.value = false
}

const liveRegistrationTicketFilename = computed(() => {
  const orderCode = String(liveRegistrationResult.value?.orderCode || 'ticket').trim()
  return `${orderCode}-ticket.pdf`
})

async function fetchLiveRegistrationTicketBlob() {
  const ticketDownloadUrl = liveRegistrationResult.value?.ticketDownloadUrl || ''
  if (!ticketDownloadUrl) {
    throw new Error('No ticket download is available for this registration.')
  }

  const result = await fetchBadgePdfWithRetry(
    normalizeApiResourcePath(ticketDownloadUrl),
    {
      baseUrl: url.value,
      apitoken: apitoken.value
    }
  )

  if (result.status === 'ready') {
    return result.blob
  }
  if (result.profileDenied) {
    throw new Error(result.detail || 'Ticket download is not allowed for this device profile.')
  }
  if (result.status === 'generating') {
    throw new Error('Ticket is still generating. Try again in a moment.')
  }
  throw new Error(result.detail || 'Could not load the ticket PDF.')
}

const printLiveRegistrationTicket = async () => {
  if (isLoadingLiveRegistrationTicket.value) {
    return
  }

  liveRegistrationTicketError.value = ''
  isLoadingLiveRegistrationTicket.value = true

  try {
    const blob = await fetchLiveRegistrationTicketBlob()
    const outcome = await printPdfBlob(blob)
    if (outcome === PRINT_OUTCOME.FAILED) {
      liveRegistrationTicketError.value = 'Could not open the print dialog for this ticket.'
    }
  } catch (error) {
    console.error('Live registration ticket print failed:', error)
    liveRegistrationTicketError.value = error?.message || 'Could not print the ticket.'
  } finally {
    isLoadingLiveRegistrationTicket.value = false
  }
}

const downloadLiveRegistrationTicket = async () => {
  if (isLoadingLiveRegistrationTicket.value) {
    return
  }

  liveRegistrationTicketError.value = ''
  isLoadingLiveRegistrationTicket.value = true

  try {
    const blob = await fetchLiveRegistrationTicketBlob()
    if (!downloadPdfBlob(blob, liveRegistrationTicketFilename.value)) {
      liveRegistrationTicketError.value = 'Could not download the ticket PDF.'
    }
  } catch (error) {
    console.error('Live registration ticket download failed:', error)
    liveRegistrationTicketError.value = error?.message || 'Could not download the ticket.'
  } finally {
    isLoadingLiveRegistrationTicket.value = false
  }
}

const submitLiveRegistration = async () => {
  if (isRegistering.value) {
    return
  }

  const attendeeName = String(liveRegistrationForm.value.attendee_name || '').trim()
  const attendeeEmail = String(liveRegistrationForm.value.attendee_email || '').trim()
  const selectedProductId = String(liveRegistrationForm.value.product_id || '').trim()

  if (!attendeeName || !attendeeEmail || !selectedProductId) {
    liveRegistrationError.value = 'Attendee name, email, and product are required.'
    return
  }

  liveRegistrationError.value = ''

  try {
    const registrationResult = await liveRegistrationStore.registerAndMarkPaid(
      {
        attendee_name: attendeeName,
        attendee_email: attendeeEmail,
        company: String(liveRegistrationForm.value.company || '').trim(),
        job_title: String(liveRegistrationForm.value.job_title || '').trim()
      },
      Number(selectedProductId)
    )

    closeLiveRegistrationDialog()
    liveRegistrationResult.value = {
      attendeeName,
      orderCode: registrationResult.orderCode,
      orderPositionId: registrationResult.orderPositionId || registrationResult.orderPosition?.id || null,
      ticketDownloadUrl: registrationResult.ticketDownloadUrl || '',
      ticketDownloadAvailable: registrationResult.ticketDownloadAvailable === true
    }
  } catch (error) {
    console.error('Live registration failed:', error)
    liveRegistrationError.value = getDeviceErrorMessage(error, 'Live registration failed.')
  }
}

const formatAttendeeForEdit = (attendeeMessage = {}) =>
  buildEditableAttendeeState(attendeeMessage, displayPopupFields.value)

async function ensureEventQuestionsLoaded() {
  if (eventQuestions.value.length > 0 || !organizer.value || !eventSlug.value) {
    return
  }

  const response = await getDeviceApi().get(
    apiV1Path(`organizers/${organizer.value}/events/${eventSlug.value}/questions/`)
  )
  eventQuestions.value = Array.isArray(response) ? response : response?.results || []
}

function isChoiceField(fieldKey) {
  const questionId = questionIdFromFieldKey(fieldKey)
  if (!questionId) {
    return false
  }
  const question = questionsById.value[questionId]
  return ['C', 'L', 'M'].includes(String(question?.type || ''))
}

function choiceOptionsForField(fieldKey) {
  const questionId = questionIdFromFieldKey(fieldKey)
  return questionsById.value[questionId]?.options || []
}

const openEditDialog = async () => {
  editError.value = ''
  try {
    await ensureEventQuestionsLoaded()
    const state = formatAttendeeForEdit(message.value)
    editableAttendee.value = state
    originalAttendee.value = {
      attendee_name: state.attendee_name,
      fields: { ...state.fields },
      _answers: message.value?.answers || []
    }
    isEditDialogOpen.value = true
  } catch (error) {
    if (handleDeviceApiError(error, processApi)) {
      editError.value = getDeviceErrorMessage(error, 'Unable to load attendee fields.')
      return
    }
    editError.value = getDeviceErrorMessage(error, 'Unable to load attendee fields.')
  }
}

const closeEditDialog = () => {
  isEditDialogOpen.value = false
  editError.value = ''
}

const getModifiedAttendeeFields = () =>
  buildAttendeePatchPayload(
    editableAttendee.value,
    originalAttendee.value,
    displayPopupFields.value,
    questionsById.value
  )

const getCheckinListId = (checkin) => {
  if (checkin?.list == null) {
    return null
  }
  if (typeof checkin.list === 'object') {
    return checkin.list.id ?? checkin.list.pk ?? null
  }
  return checkin.list
}

const getLastCheckinFromArray = (checkins, listId = selectedCheckInListId.value) => {
  if (!checkins?.length) {
    return null
  }

  let relevant = checkins
  if (listId) {
    const scoped = checkins.filter(
      (checkin) => String(getCheckinListId(checkin)) === String(listId)
    )
    if (scoped.length) {
      relevant = scoped
    }
  }

  return relevant.reduce((latest, checkin) => {
    if (!latest) {
      return checkin
    }
    return new Date(checkin.datetime) > new Date(latest.datetime) ? checkin : latest
  }, null)
}

const ensureCheckinsReflectRedeem = (checkins, redeemContext) => {
  const next = Array.isArray(checkins) ? [...checkins] : []
  if (!redeemContext || (redeemContext.status !== 'ok' && redeemContext.status !== 'redeemed')) {
    return next
  }

  const listId = selectedCheckInListId.value
  const last = getLastCheckinFromArray(next, listId)
  const fallbackListId = listId || getCheckinListId(last) || getCheckinListId(next[0])
  const timestamp = new Date().toISOString()

  if (redeemContext.action === 'exit' && redeemContext.status === 'ok') {
    if (last?.type === 'exit') {
      return next
    }
    next.push({ type: 'exit', list: fallbackListId, datetime: timestamp })
    return next
  }

  if (redeemContext.action === 'entry') {
    if (redeemContext.status === 'redeemed' || last?.type === 'entry') {
      if (!next.length) {
        next.push({ type: 'entry', list: fallbackListId, datetime: timestamp })
      }
      return next
    }
    if (redeemContext.status === 'ok' && last?.type !== 'entry') {
      next.push({ type: 'entry', list: fallbackListId, datetime: timestamp })
    }
  }

  return next
}

const buildOrderUpdateFromPosition = (updatedOrderPosition, existingOrder = {}, redeemContext = null) => ({
  ...existingOrder,
  ...updatedOrderPosition,
  attendee_name: updatedOrderPosition.attendee_name || existingOrder.attendee_name,
  attendee_email: updatedOrderPosition.attendee_email || existingOrder.attendee_email,
  company: updatedOrderPosition.company ?? existingOrder.company ?? '',
  job_title: updatedOrderPosition.job_title ?? existingOrder.job_title ?? '',
  checkins: ensureCheckinsReflectRedeem(
    Array.isArray(updatedOrderPosition.checkins)
      ? updatedOrderPosition.checkins
      : existingOrder.checkins,
    redeemContext
  ),
  downloads: updatedOrderPosition.downloads || existingOrder.downloads
})

const updateOrderInSearchResults = (updatedOrderPosition, redeemContext = null) => {
  if (!updatedOrderPosition?.id) {
    return
  }

  const replaceOrder = (orderList) => {
    const index = orderList.findIndex(
      (order) => String(order.id) === String(updatedOrderPosition.id)
    )
    if (index < 0) {
      return orderList
    }

    const nextList = [...orderList]
    nextList[index] = buildOrderUpdateFromPosition(
      updatedOrderPosition,
      orderList[index],
      redeemContext
    )
    return nextList
  }

  orders.value = replaceOrder(orders.value)

  for (const [query, cached] of searchCache.entries()) {
    searchCache.set(query, replaceOrder(cached))
  }
}

const updatePopupAttendee = (updatedOrderPosition) => {
  if (!updatedOrderPosition) {
    return
  }

  message.value = {
    ...message.value,
    attendee: updatedOrderPosition.attendee_name || message.value?.attendee || '',
    attendee_name: updatedOrderPosition.attendee_name || '',
    attendee_email: updatedOrderPosition.attendee_email || message.value?.attendee_email || '',
    product_id: updatedOrderPosition.product || message.value?.product_id || null,
    company: updatedOrderPosition.company || message.value?.company || '',
    job_title: updatedOrderPosition.job_title || message.value?.job_title || '',
    answers: updatedOrderPosition.answers || message.value?.answers || [],
    orderPositionId: updatedOrderPosition.id || message.value?.orderPositionId || null
  }
}

const patchAttendeeDetails = async (orderPositionId, payload) => {
  try {
    return await getDeviceApi().patch(
      apiV1Path(
        `organizers/${organizer.value}/events/${eventSlug.value}/orderpositions/${orderPositionId}/`
      ),
      payload
    )
  } catch (error) {
    if (handleDeviceApiError(error, processApi)) {
      throw new Error(getDeviceErrorMessage(error, 'Unable to update attendee details'))
    }
    throw new Error(getDeviceErrorMessage(error, 'Unable to update attendee details'))
  }
}

const resolveOrderPositionId = async (knownOrderPositionId, attendeeSecret) => {
  if (knownOrderPositionId) {
    return knownOrderPositionId
  }

  const normalizedSecret = String(attendeeSecret || '').trim()
  if (!normalizedSecret) {
    return null
  }

  const params = new URLSearchParams({
    search: normalizedSecret,
    page_size: '50',
    include_canceled_positions: 'true'
  })
  const response = await getDeviceApi().get(
    apiV1Path(
      `organizers/${organizer.value}/events/${eventSlug.value}/orderpositions/?${params.toString()}`
    )
  )
  const exactMatch = (response.results || []).find(
    (orderPosition) => String(orderPosition.secret || '').trim() === normalizedSecret
  )

  return exactMatch?.id || null
}

const saveAttendeeDetails = async () => {
  if (isSavingAttendee.value) {
    return
  }

  const attendeeSecret = message.value?.secret
  if (!attendeeSecret) {
    editError.value = 'Attendee details are missing for this scan.'
    return
  }

  isSavingAttendee.value = true
  editError.value = ''

  try {
    const orderPositionId = await resolveOrderPositionId(
      message.value?.orderPositionId,
      attendeeSecret
    )

    const patchPayload = getModifiedAttendeeFields()
    if (Object.keys(patchPayload).length === 0) {
      isEditDialogOpen.value = false
      return
    }

    if (!orderPositionId) {
      throw new Error('Unable to determine attendee record for update.')
    }

    const updatedOrderPosition = await patchAttendeeDetails(orderPositionId, patchPayload)
    updatePopupAttendee(updatedOrderPosition)
    updateOrderInSearchResults(updatedOrderPosition)
    notificationStore.addNotification(['Attendee', 'Details updated'], 'success')
    isEditDialogOpen.value = false
  } catch (error) {
    console.error('Error saving attendee details:', error)
    editError.value = error?.message || 'Unable to save attendee details.'
  } finally {
    isSavingAttendee.value = false
  }
}

const getNormalizedSearchQuery = (query) => query.trim().toLowerCase()
const sortOrdersByAttendeeName = (resultList) =>
  [...resultList].sort((left, right) =>
    (left.attendee_name || '').localeCompare(right.attendee_name || '', undefined, {
      sensitivity: 'base'
    })
  )

const buildSearchPath = (query) => {
  const params = new URLSearchParams({
    search: query,
    page_size: String(SEARCH_RESULTS_LIMIT),
    order__status__in: 'p,n,c',
    include_canceled_positions: 'true',
    exclude_details: 'true'
  })
  return apiV1Path(
    `organizers/${organizer.value}/events/${eventSlug.value}/orderpositions/?${params.toString()}`
  )
}

const orderMatchesSearchQuery = (order, normalizedQuery) => {
  const name = (order.attendee_name || '').toLowerCase()
  const email = (order.attendee_email || '').toLowerCase()
  const secret = (order.secret || '').toLowerCase()
  return (
    name.includes(normalizedQuery) ||
    email.includes(normalizedQuery) ||
    secret.includes(normalizedQuery)
  )
}

const filterSessionCachedOrders = (normalizedQuery) => {
  const allCachedOrders = []
  const seen = new Set()
  for (const cachedList of searchCache.values()) {
    for (const order of cachedList) {
      if (!seen.has(order.id)) {
        seen.add(order.id)
        allCachedOrders.push(order)
      }
    }
  }
  return allCachedOrders.filter((order) => orderMatchesSearchQuery(order, normalizedQuery))
}

const searchOrders = async (query, { force = false, requestId = ++activeRequestId } = {}) => {
  const normalizedQuery = getNormalizedSearchQuery(query)

  if (requestId !== activeRequestId) {
    return
  }

  if (!normalizedQuery || normalizedQuery.length < MIN_SEARCH_LENGTH) {
    orders.value = []
    loading.value = false
    return
  }

  if (!force && searchCache.has(normalizedQuery)) {
    orders.value = searchCache.get(normalizedQuery)
    loading.value = false
    return
  }

  loading.value = true
  try {
    const response = await getDeviceApi().get(buildSearchPath(normalizedQuery))
    if (requestId !== activeRequestId) {
      return
    }
    const results = sortOrdersByAttendeeName(response.results || [])
    searchCache.set(normalizedQuery, results)
    orders.value = results
  } catch (error) {
    if (requestId !== activeRequestId) {
      return
    }
    console.error('Error fetching orders:', error)

    if (isDeviceProfileDenied(error)) {
      notificationStore.addNotification(['Access denied', getDeviceErrorMessage(error)], 'error')
      orders.value = []
      return
    }

    const filtered = filterSessionCachedOrders(normalizedQuery)

    if (filtered.length > 0) {
      orders.value = sortOrdersByAttendeeName(filtered)
      notificationStore.addNotification(
        ['Search unavailable', 'Showing results from this session only.'],
        'info'
      )
    } else {
      notificationStore.addNotification(
        ['Search failed', getDeviceErrorMessage(error, 'Unable to search attendees.')],
        'error'
      )
      orders.value = []
    }
  } finally {
    if (requestId === activeRequestId) {
      loading.value = false
    }
  }
}

onMounted(async () => {
  checkinSettings.syncAutoPrintForRole(selectedRole.value)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (isKioskShell.value && isBadgeStation.value) {
    enterKioskShell()
  }
  loadingStore.contentLoading()

  try {
    await waitForDesignAssets()

    await Promise.all([
      eventyayEventStore.events.length
        ? Promise.resolve()
        : eventyayEventStore.fetchEvents(),
      isBadgeStation.value
        ? Promise.resolve()
        : liveRegistrationStore.fetchProducts(),
      processEventyayCheckInStore.prefetchCheckInLists(),
      ensureEventQuestionsLoaded()
    ])
    if (!isBadgeStation.value) {
      resetLiveRegistrationForm()
    }
    checkInReady.value = true
  } catch (error) {
    console.error('Error loading check-in page:', error)
    notificationStore.addNotification(['Error', 'Unable to load check-in page'], 'error')
    checkInReady.value = true
  } finally {
    loadingStore.contentLoaded()
  }
})

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    processEventyayCheckInStore.refreshCheckInListsInBackground()
  }
}

watch(
  () => `${organizer.value}:${eventSlug.value}`,
  (cacheKey, previousKey) => {
    if (previousKey && cacheKey !== previousKey) {
      processEventyayCheckInStore.reloadCheckInListsForCurrentEvent()
    }
  }
)

watch(searchQuery, (value) => {
  activeRequestId += 1
  const requestId = activeRequestId

  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  const normalizedQuery = getNormalizedSearchQuery(value)
  if (!normalizedQuery || normalizedQuery.length < MIN_SEARCH_LENGTH) {
    orders.value = []
    loading.value = false
    return
  }

  debounceTimer = setTimeout(() => {
    searchOrders(value, { requestId })
  }, SEARCH_DEBOUNCE_MS)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)

  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
})

const getLastCheckinForOrder = (order, listId = selectedCheckInListId.value) =>
  getLastCheckinFromArray(order?.checkins, listId)

const isCheckedIn = (order) => getLastCheckinForOrder(order)?.type === 'entry'

const isPositionCanceled = (order) =>
  Boolean(order?.canceled) || String(order?.order__status || '').toLowerCase() === 'c'

const getAttendeeActionLabel = (order) => {
  if (isPositionCanceled(order)) {
    return 'Canceled'
  }
  if (isBadgeStation.value) {
    return isCheckedIn(order) ? 'View & print' : 'Check in & print'
  }
  return isCheckedIn(order) ? 'Checked in' : 'Check in'
}

const openAttendeeFromSearch = async (order) => {
  cameraStore.clearLastScan()
  if (isPositionCanceled(order)) {
    showCanceledAttendeeFromSearch(order)
    return
  }
  cameraStore.isProcessing = true
  const response = await processEventyayCheckInStore.checkInBySecret(order.secret, {
    attendeeHints: {
      attendee_name: order.attendee_name,
      attendee_email: order.attendee_email,
      company: order.company,
      job_title: order.job_title
    }
  })
  if (!response || (response.status !== 'ok' && response.status !== 'redeemed')) {
    if (!showSuccess.value && !showError.value) {
      notificationStore.addNotification(['Error', 'Unable to open attendee details'], 'error')
    }
    cameraStore.isProcessing = false
    return
  }

  if (response.position) {
    updateOrderInSearchResults(response.position, {
      action: 'entry',
      status: response.status
    })
  }
}
</script>

<template>
  <div
    v-if="checkInReady"
    class="page-shell flex flex-col py-4 sm:py-5 lg:h-[calc(100dvh-2.75rem-1.25rem)] lg:max-h-[calc(100dvh-2.75rem-1.25rem)] lg:overflow-hidden"
  >
    <div class="mb-3 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <h1>{{ isBadgeStation ? 'Badge Station' : 'Check-in' }}</h1>
        <p class="mt-1 text-sm text-body-muted">
          {{
            isBadgeStation
              ? 'Scan tickets to print badges. Already checked-in attendees can reprint.'
              : 'Scan tickets on the left or search attendees on the right.'
          }}
        </p>
      </div>
      <div class="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
        <StandardButton
          v-if="showLiveRegistrationEntry"
          type="button"
          text="Live registration"
          variant="success"
          size="sm"
          class="w-full justify-center sm:w-auto"
          :disabled="isRegistering"
          @click="openLiveRegistrationDialog"
        />
        <p
          v-if="showLiveRegistrationEntry && isLoadingProducts"
          class="text-center text-xs text-body-muted sm:text-right"
        >
          Loading ticket products…
        </p>
        <div v-if="selectedCheckInListName || gateName" class="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
        <div
          v-if="gateName"
          class="rounded-xl border border-surface-border bg-surface-muted px-3.5 py-1.5 text-xs font-semibold text-body-muted"
        >
          {{ gateName }}
        </div>
        <div
          v-if="selectedCheckInListName"
          class="rounded-xl bg-primary/10 border border-primary/20 px-3.5 py-1.5 text-xs font-semibold text-primary"
        >
          Active List: {{ selectedCheckInListName }}
        </div>
        </div>
      </div>
    </div>

    <div
      class="grid min-h-0 flex-1 gap-5"
      :class="isBadgeStation ? 'max-w-2xl mx-auto w-full' : 'lg:grid-cols-2'"
    >
      <section class="card flex min-h-0 flex-col overflow-hidden p-5 sm:p-6">
        <p class="section-title mb-4 shrink-0">QR scanner</p>
        <div class="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto">
        <QRCamera
          qr-type="eventyaycheckin"
          :scan-type="isBadgeStation ? 'Badge' : 'Check-In'"
        />

        <div
          v-if="isBadgeStation && autoPrintEnabled"
          class="mt-5 flex items-center justify-between rounded-xl border border-surface-border bg-surface-muted px-4 py-3"
        >
          <div>
            <p class="text-sm font-semibold text-body">Customize badge before printing</p>
            <p class="text-xs text-body-muted">
              {{
                autoPrintCustomizeOnce
                  ? 'Shows field options once, then prints.'
                  : 'Prints immediately using the default badge layout.'
              }}
            </p>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-300 ease-in-out items-center focus:outline-none focus:ring-2 focus:ring-primary/20"
            :class="autoPrintCustomizeOnce ? 'bg-primary' : 'bg-[#E9E9EB]'"
            role="switch"
            :aria-checked="autoPrintCustomizeOnce"
            @click="toggleAutoPrintCustomizeOnce"
          >
            <span
              class="absolute left-2.5 h-2.5 w-0.5 rounded-full bg-white transition-opacity duration-300"
              :class="autoPrintCustomizeOnce ? 'opacity-100' : 'opacity-0'"
            />
            <span
              class="absolute right-2 h-2 w-2 rounded-full border border-body-light transition-opacity duration-300"
              :class="autoPrintCustomizeOnce ? 'opacity-0' : 'opacity-100'"
            />
            <span
              aria-hidden="true"
              class="relative inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-300 ease-in-out z-10"
              :class="autoPrintCustomizeOnce ? 'translate-x-5' : 'translate-x-0'"
            />
          </button>
        </div>

        <div
          v-if="isBadgeStation && autoPrintFeedback"
          class="mt-3 rounded-xl border px-4 py-2.5 text-sm"
          :class="{
            'border-primary/20 bg-primary/5 text-body-muted': autoPrintFeedback.status === 'printing',
            'border-danger/20 bg-danger/5 text-danger': autoPrintFeedback.status === 'error'
          }"
          role="status"
          aria-live="polite"
        >
          {{ autoPrintFeedback.text }}
        </div>
        </div>
      </section>

      <section v-if="!isBadgeStation" class="card flex min-h-0 flex-col overflow-hidden p-5 sm:p-6">
        <p class="section-title mb-4 shrink-0">Search</p>

        <div class="relative mb-4 shrink-0">
          <MagnifyingGlassIcon class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-body-muted" />
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search by name or email..."
            class="pl-10"
          />
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="!searchQuery" class="flex h-full items-center justify-center text-center">
            <p class="text-sm text-body-muted">Type at least 2 characters to search attendees.</p>
          </div>

          <div v-else-if="loading" class="py-10 text-center text-sm text-body-muted">
            Searching...
          </div>

          <div v-else-if="orders.length === 0" class="py-10 text-center text-sm text-body-muted">
            No matching attendees found.
          </div>

          <TransitionGroup v-else name="list" tag="div" class="space-y-2">
            <article
              v-for="order in orders"
              :key="order.id"
              class="rounded-xl border border-surface-border bg-surface-muted p-4"
            >
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <h3 class="truncate font-semibold text-body">{{ order.attendee_name }}</h3>
                  <p class="truncate text-sm text-body-muted">
                    {{ order.attendee_email || 'No email' }}
                  </p>
                  <p v-if="order.company" class="truncate text-sm text-body-muted">
                    {{ order.company }}
                  </p>
                  <p v-if="order.job_title" class="truncate text-sm text-body-muted">
                    {{ order.job_title }}
                  </p>
                </div>
                <StandardButton
                  :text="getAttendeeActionLabel(order)"
                  :variant="
                    (isCheckedIn(order) || isPositionCanceled(order)) && !isBadgeStation ? 'white' : 'success'
                  "
                  size="sm"
                  @click="openAttendeeFromSearch(order)"
                />
              </div>
            </article>
          </TransitionGroup>
        </div>
      </section>
    </div>

    <Transition name="modal">
      <div
        v-if="isLiveRegistrationDialogOpen"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      >
        <div class="card w-full max-w-md p-6">
          <h2 class="mb-4">Register attendee</h2>
          <div class="space-y-3">
            <div>
              <label>Name</label>
              <input v-model="liveRegistrationForm.attendee_name" type="text" class="mt-1" />
            </div>
            <div>
              <label>Email</label>
              <input v-model="liveRegistrationForm.attendee_email" type="email" class="mt-1" />
            </div>
            <div>
              <label>Company</label>
              <input v-model="liveRegistrationForm.company" type="text" class="mt-1" />
            </div>
            <div>
              <label>Job title</label>
              <input v-model="liveRegistrationForm.job_title" type="text" class="mt-1" />
            </div>
            <div>
              <label>Product</label>
              <select
                v-model="liveRegistrationForm.product_id"
                class="mt-1"
                :disabled="isLoadingProducts || !products.length"
              >
                <option disabled value="">
                  {{ isLoadingProducts ? 'Loading products…' : 'Select product' }}
                </option>
                <option v-for="product in products" :key="product.id" :value="String(product.id)">
                  {{ getProductDisplayLabel(product) }}
                </option>
              </select>
              <p v-if="!isLoadingProducts && !products.length" class="mt-1 text-xs text-danger">
                No ticket products are available for this event.
              </p>
            </div>
          </div>

          <p v-if="liveRegistrationError" class="mt-3 text-sm text-danger">
            {{ liveRegistrationError }}
          </p>

          <div class="mt-6 flex justify-end gap-2">
            <StandardButton
              type="button"
              text="Cancel"
              variant="white"
              :disabled="isRegistering"
              @click="closeLiveRegistrationDialog"
            />
            <StandardButton
              type="button"
              :text="isRegistering ? 'Registering...' : 'Register'"
              variant="primary"
              :disabled="isRegistering || isLoadingProducts || !products.length"
              @click="submitLiveRegistration"
            />
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal">
      <div
        v-if="liveRegistrationResult"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      >
        <div class="card w-full max-w-md p-6">
          <h2 class="mb-1 text-xl text-success">Registration complete</h2>
          <p class="mb-4 text-sm text-body-muted">
            {{ liveRegistrationResult.attendeeName }}
            <span v-if="liveRegistrationResult.orderCode">
              · Order {{ liveRegistrationResult.orderCode }}
            </span>
          </p>

          <p
            v-if="!liveRegistrationResult.ticketDownloadAvailable"
            class="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-dark"
          >
            Ticket PDF download is not configured for this event. Enable the PDF ticket output
            plugin and ensure a Celery worker is running for ticket generation.
          </p>

          <p v-if="liveRegistrationTicketError" class="mt-3 text-sm text-danger">
            {{ liveRegistrationTicketError }}
          </p>

          <div class="mt-6 space-y-2">
            <StandardButton
              v-if="liveRegistrationResult.ticketDownloadAvailable"
              type="button"
              :text="isLoadingLiveRegistrationTicket ? 'Preparing ticket…' : 'Print ticket'"
              variant="primary"
              block
              :disabled="isLoadingLiveRegistrationTicket"
              @click="printLiveRegistrationTicket"
            />
            <StandardButton
              v-if="liveRegistrationResult.ticketDownloadAvailable"
              type="button"
              :text="isLoadingLiveRegistrationTicket ? 'Preparing ticket…' : 'Download ticket'"
              variant="white"
              block
              :disabled="isLoadingLiveRegistrationTicket"
              @click="downloadLiveRegistrationTicket"
            />
            <StandardButton
              type="button"
              text="Done"
              variant="white"
              block
              @click="closeLiveRegistrationSuccess"
            />
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal">
      <div
        v-if="isEditDialogOpen"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      >
        <div class="card w-full max-w-md p-6">
          <h2 class="mb-4">Edit attendee</h2>
          <div class="space-y-3">
            <div>
              <label>Name</label>
              <input v-model="editableAttendee.attendee_name" type="text" class="mt-1" />
            </div>
            <div
              v-for="fieldKey in attendeeEditFieldKeys.filter((key) => key !== 'attendee_name')"
              :key="fieldKey"
            >
              <label>{{ questionLabelForField(fieldKey, questionsById) }}</label>
              <select
                v-if="isChoiceField(fieldKey)"
                v-model="editableAttendee.fields[fieldKey]"
                class="mt-1"
              >
                <option value="">Select an option</option>
                <option
                  v-for="option in choiceOptionsForField(fieldKey)"
                  :key="option.id"
                  :value="option.answer"
                >
                  {{ option.answer }}
                </option>
              </select>
              <input
                v-else
                v-model="editableAttendee.fields[fieldKey]"
                :type="fieldKey === 'attendee_email' ? 'email' : 'text'"
                class="mt-1"
              />
            </div>
          </div>
          <p v-if="editError" class="mt-3 text-sm text-danger">{{ editError }}</p>
          <div class="mt-6 flex justify-end gap-2">
            <StandardButton
              type="button"
              text="Cancel"
              variant="white"
              :disabled="isSavingAttendee"
              @click="closeEditDialog"
            />
            <StandardButton
              type="button"
              :text="isSavingAttendee ? 'Saving…' : 'Save attendee'"
              variant="primary"
              :disabled="isSavingAttendee"
              @click="saveAttendeeDetails"
            />
          </div>
        </div>
      </div>
    </Transition>

    <AttendeeInfoModal
      v-if="showAttendeeModal"
      :message="message"
      :show-success="showSuccess"
      :show-error="showError"
      :badge-url="badgeUrl"
      :product-name="getCheckedInProductName(message?.product_id, message?.variation)"
      :is-generating-badge="isGeneratingBadge"
      :badge-station="isBadgeStation"
      :auto-print-enabled="shouldAutoPrintBadge && !message?.manualReprintOnly"
      :auto-dismiss="Boolean(message?.manualReprintOnly)"
      :duration="10"
      :display-fields="displayPopupFields"
      :question-labels="popupQuestionLabels"
      :paused="attendeeModalPaused"
      @preview="openBadgePreviewFromModal"
      @print="handleModalPrint"
      @edit="openEditDialog"
      @edit-badge="openBadgeEditDialog"
      @exit="handleExitFromModal"
      @checkin="handleCheckInAfterCheckout"
      @checkout-confirm="isCheckoutConfirmOpen = $event"
      @close="closePopup"
      @timeout="closePopup"
    />

    <BadgeCustomizeModal
      v-if="badgeCustomizeRequest"
      :fields="badgeCustomizeRequest.customization.fields"
      :hidden-fields="badgeCustomizeRequest.customization.hidden_fields || []"
      :field-overrides="badgeCustomizeRequest.customization.field_overrides || {}"
      :allow-badge-editing="Boolean(badgeCustomizeRequest.customization.allow_badge_editing)"
      :show-preview="Boolean(badgeCustomizeRequest.badgeUrlPath || badgeUrl)"
      :mode="badgeCustomizeRequest.editMode ? 'edit' : 'print'"
      @preview="handleBadgeCustomizePreview"
      @confirm="resolveBadgeCustomization"
      @cancel="cancelBadgeCustomization"
    />

    <BadgePrintPreview
      v-if="showPrintPreview && badgeUrl"
      :key="badgePreviewKey"
      :badge-path="badgeUrl"
      @close="handlePrintClose"
    />
  </div>
</template>

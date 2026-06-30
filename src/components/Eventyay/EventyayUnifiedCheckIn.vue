<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { apiV1Path, createAuthorizedDeviceApi } from '@/utils/serverUrl'
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
import { MagnifyingGlassIcon, PrinterIcon, ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
import QRCamera from '@/components/Common/QRCamera.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import BadgePrintPreview from '@/components/Common/BadgePrintPreview.vue'
import AttendeeInfoModal from '@/components/Eventyay/AttendeeInfoModal.vue'
import BadgeCustomizeModal from '@/components/Eventyay/BadgeCustomizeModal.vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useLiveRegistrationStore } from '@/stores/liveRegistration'
import { useLoadingStore } from '@/stores/loading'
import { useNotificationStore } from '@/stores/notification'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { getAutoPrintPreference, setAutoPrintPreference } from '@/utils/session'
import { PRINT_OUTCOME } from '@/utils/badgePdf'
import { waitForDesignAssets } from '@/utils/waitForDesignAssets'
import {
  buildChromeKioskCommand,
  buildFirefoxKioskCommand,
  buildKioskUrl,
  enterKioskShell,
  getPlatformLabel,
  getShellLabel
} from '@/utils/kioskLauncher'

const KIOSK_SETUP_ACK_KEY = 'eventyay-badge-station-kiosk-ack'

const notificationStore = useNotificationStore()
const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug, selectedRole, selectedCheckInListId, gateName } = storeToRefs(processApi)
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const { message, showSuccess, showError, badgeUrl, isGeneratingBadge, availableCheckInLists, autoPrintFeedback, badgeCustomizeRequest } = storeToRefs(
  processEventyayCheckInStore
)
const {
  clearAutoPrintFeedback,
  checkOutBySecret,
  checkInBySecret,
  showOfferCheckInMsg,
  buildAttendeeMessage,
  getSelectedCheckInList,
  resolveBadgeCustomization,
  cancelBadgeCustomization,
  openBadgeCustomization,
  printBadgeWithOptionalCustomization
} = processEventyayCheckInStore
const liveRegistrationStore = useLiveRegistrationStore()
const { products, isLoadingProducts, isRegistering } = storeToRefs(liveRegistrationStore)
const loadingStore = useLoadingStore()

const route = useRoute()
const skipKioskSetup = ref(sessionStorage.getItem(KIOSK_SETUP_ACK_KEY) === '1')
const checkInReady = ref(false)
const kioskTargetUrl = computed(() => buildKioskUrl(window.location.origin, route.fullPath))
const chromeKioskCommand = computed(() => buildChromeKioskCommand(kioskTargetUrl.value))
const firefoxKioskCommand = computed(() => buildFirefoxKioskCommand(kioskTargetUrl.value))
const kioskPlatformLabel = computed(() => getPlatformLabel())
const kioskShellLabel = computed(() => getShellLabel())
const copiedKioskCommand = ref('')

async function copyKioskCommand(command, label) {
  try {
    await navigator.clipboard.writeText(command)
    copiedKioskCommand.value = label
    setTimeout(() => {
      copiedKioskCommand.value = ''
    }, 2000)
  } catch {
    notificationStore.addNotification(
      ['Copy failed', 'Select the command below and copy it manually.'],
      'warning'
    )
  }
}

function acknowledgeKioskSetup({ launchedInKiosk = false } = {}) {
  skipKioskSetup.value = true
  sessionStorage.setItem(KIOSK_SETUP_ACK_KEY, '1')
  if (launchedInKiosk || route.query.kiosk === 'true') {
    enterKioskShell()
  }
}

const selectedCheckInListName = computed(() => {
  const list = availableCheckInLists.value.find(
    (l) => String(l.id) === String(selectedCheckInListId.value)
  )
  return list ? list.name : ''
})

function getDeviceApi() {
  return createAuthorizedDeviceApi(url.value, apitoken.value)
}

const searchQuery = ref('')
const orders = ref([])
const loading = ref(false)
const showPrintPreview = ref(false)
const isEditDialogOpen = ref(false)
const isSavingAttendee = ref(false)
const editError = ref('')
const isBadgeStation = computed(() => selectedRole.value === 'Badge Station')
const showBadgeStationSetup = computed(
  () => isBadgeStation.value && !skipKioskSetup.value
)
const showLiveRegistrationEntry = computed(() => !isBadgeStation.value)
const autoPrintBadge = ref(getAutoPrintPreference(selectedRole.value))
const shouldAutoPrintBadge = computed(() => isBadgeStation.value && autoPrintBadge.value)
const attendeeModalPaused = computed(() => isEditDialogOpen.value || showPrintPreview.value)

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

watch(autoPrintBadge, (enabled) => {
  if (isBadgeStation.value) {
    setAutoPrintPreference(selectedRole.value, enabled)
  }
  if (!enabled) {
    clearAutoPrintFeedback()
  }
})

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

const handleModalPrint = async () => {
  if (!badgeUrl.value) {
    return
  }
  const position = {
    id: message.value?.orderPositionId,
    badge_customization: message.value?.badge_customization
  }

  if (isBadgeStation.value) {
    const outcome = await printBadgeWithOptionalCustomization(badgeUrl.value, position)
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
    const hiddenFields = await openBadgeCustomization(position.badge_customization, position.id)
    if (!hiddenFields) {
      return
    }
    if (message.value) {
      message.value = {
        ...message.value,
        badge_customization: {
          ...position.badge_customization,
          hidden_fields: hiddenFields
        }
      }
    }
  }

  openBadgePreviewFromModal()
}

const handleCustomizeBadge = async () => {
  const customization = message.value?.badge_customization
  const positionId = message.value?.orderPositionId
  if (!customization?.allow_customization || !customization.fields?.length) {
    return
  }

  const hiddenFields = await openBadgeCustomization(customization, positionId)
  if (!hiddenFields || !message.value) {
    return
  }

  message.value = {
    ...message.value,
    badge_customization: {
      ...customization,
      hidden_fields: hiddenFields
    }
  }
  notificationStore.addNotification(['Badge', 'Customization saved'], 'success')
}

const handleExitFromModal = async () => {
  const secret = message.value?.secret
  if (!secret) {
    closePopup()
    return
  }
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
  await checkInBySecret(secret, {
    attendeeHints: {
      attendee_name: message.value?.attendee_name,
      attendee_email: message.value?.attendee_email,
      company: message.value?.company,
      job_title: message.value?.job_title
    }
  })
}

const openBadgePreview = () => {
  if (!badgeUrl.value) {
    return
  }
  showPrintPreview.value = true
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

    const checkInResponse = await processEventyayCheckInStore.checkInBySecret(
      registrationResult.secret,
      {
        attendeeHints: {
          attendee_name: attendeeName,
          attendee_email: attendeeEmail,
          company: String(liveRegistrationForm.value.company || '').trim(),
          job_title: String(liveRegistrationForm.value.job_title || '').trim()
        }
      }
    )
    if (
      !checkInResponse ||
      (checkInResponse.status !== 'ok' && checkInResponse.status !== 'redeemed')
    ) {
      throw new Error('Registration completed but automatic check-in failed.')
    }

    closeLiveRegistrationDialog()
    notificationStore.addNotification(['Success', 'Attendee registered and checked in'], 'success')
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

const updateOrderInSearchResults = (updatedOrderPosition) => {
  if (!updatedOrderPosition?.id) {
    return
  }

  const matchedOrder = orders.value.find(
    (order) => String(order.id) === String(updatedOrderPosition.id)
  )
  if (!matchedOrder) {
    return
  }

  matchedOrder.attendee_name = updatedOrderPosition.attendee_name || matchedOrder.attendee_name
  matchedOrder.attendee_email = updatedOrderPosition.attendee_email || matchedOrder.attendee_email
  matchedOrder.company = updatedOrderPosition.company || ''
  matchedOrder.job_title = updatedOrderPosition.job_title || ''
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
    page_size: '50'
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

const saveAttendeeAndCheckIn = async () => {
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
    if (Object.keys(patchPayload).length > 0) {
      if (!orderPositionId) {
        throw new Error('Unable to determine attendee record for update.')
      }
      const updatedOrderPosition = await patchAttendeeDetails(orderPositionId, patchPayload)
      updatePopupAttendee(updatedOrderPosition)
      updateOrderInSearchResults(updatedOrderPosition)
    }

    const checkInResponse = await processEventyayCheckInStore.checkInBySecret(attendeeSecret, {
      attendeeHints: {
        attendee_name: editableAttendee.value.attendee_name,
        attendee_email: editableAttendee.value.fields.attendee_email || message.value?.attendee_email || '',
        company: editableAttendee.value.fields.company || message.value?.company || '',
        job_title: editableAttendee.value.fields.job_title || message.value?.job_title || '',
        answers: message.value?.answers || []
      }
    })
    if (
      !checkInResponse ||
      (checkInResponse.status !== 'ok' && checkInResponse.status !== 'redeemed')
    ) {
      throw new Error('Attendee updated, but check-in failed.')
    }

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
    order__status__in: 'p,n',
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
  document.addEventListener('visibilitychange', handleVisibilityChange)
  loadingStore.contentLoading()

  try {
    await waitForDesignAssets()

    await Promise.all([
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

const isCheckedIn = (order) => order.checkins && order.checkins.length > 0

const getAttendeeActionLabel = (order) => {
  if (isBadgeStation.value) {
    return isCheckedIn(order) ? 'View & print' : 'Check in & print'
  }
  return isCheckedIn(order) ? 'Checked in' : 'Check in'
}

const isAttendeeActionDisabled = (order) => !isBadgeStation.value && isCheckedIn(order)

const checkIn = async (order) => {
  const response = await processEventyayCheckInStore.checkInBySecret(order.secret, {
    attendeeHints: {
      attendee_name: order.attendee_name,
      attendee_email: order.attendee_email,
      company: order.company,
      job_title: order.job_title
    }
  })
  if (!response || (response.status !== 'ok' && response.status !== 'redeemed')) {
    notificationStore.addNotification(['Error', 'Unable to check in attendee'], 'error')
    return
  }

  order.checkins = response.position?.checkins || [
    ...(order.checkins || []),
    { datetime: new Date().toISOString() }
  ]
  if (response.position?.downloads) {
    order.downloads = response.position.downloads
  }
  order.attendee_name = response.position?.attendee_name || order.attendee_name
  order.attendee_email = response.position?.attendee_email || order.attendee_email
  order.company = response.position?.company || order.company || ''
  order.job_title = response.position?.job_title || order.job_title || ''
}
</script>

<template>
  <div v-if="checkInReady">
    <div v-if="showBadgeStationSetup" class="page-shell flex min-h-[60vh] items-center justify-center">
    <div class="card w-full max-w-lg p-5 shadow-card border border-surface-border">
      <div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <PrinterIcon class="h-5 w-5" width="20" height="20" style="width: 20px; height: 20px;" />
      </div>
      <h2 class="text-center text-lg">Badge Station</h2>
      <p class="mt-1.5 text-center text-xs text-body-muted leading-relaxed">
        Commands for {{ kioskPlatformLabel }}. Run one in {{ kioskShellLabel }}, then continue below.
      </p>

      <ul class="mt-3 space-y-1.5 text-left text-xs leading-relaxed text-body-muted">
        <li class="flex gap-2">
          <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <span>Fullscreen kiosk mode</span>
        </li>
        <li class="flex gap-2">
          <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <span>Silent printing without a print dialog</span>
        </li>
        <li class="flex gap-2">
          <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <span>Same browser profile — you stay logged in</span>
        </li>
      </ul>

      <div class="mt-4 space-y-3 text-left">
        <div class="rounded-xl border border-surface-border bg-surface-muted p-3">
          <div class="flex flex-wrap items-center gap-1.5">
            <p class="text-xs font-semibold text-body">Google Chrome</p>
            <span class="rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
              Recommended
            </span>
          </div>
          <pre
            class="mt-2 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 text-[10px] leading-snug text-body"
          >{{ chromeKioskCommand }}</pre>
          <StandardButton
            type="button"
            :text="copiedKioskCommand === 'chrome' ? 'Copied' : 'Copy Chrome command'"
            class="btn-primary mt-2 w-full justify-center"
            size="sm"
            @click="copyKioskCommand(chromeKioskCommand, 'chrome')"
          />
        </div>

        <div class="rounded-xl border border-surface-border bg-surface-muted p-3">
          <p class="text-xs font-semibold text-body">Mozilla Firefox</p>
          <pre
            class="mt-2 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 text-[10px] leading-snug text-body"
          >{{ firefoxKioskCommand }}</pre>
          <StandardButton
            type="button"
            :text="copiedKioskCommand === 'firefox' ? 'Copied' : 'Copy Firefox command'"
            class="btn-white mt-2 w-full justify-center"
            size="sm"
            @click="copyKioskCommand(firefoxKioskCommand, 'firefox')"
          />
        </div>
      </div>

      <StandardButton
        type="button"
        text="I already ran the command"
        class="btn-primary mt-4 w-full justify-center"
        size="sm"
        @click="acknowledgeKioskSetup({ launchedInKiosk: true })"
      />
      <StandardButton
        type="button"
        text="Continue in this browser"
        class="btn-white mt-2 w-full justify-center"
        size="sm"
        @click="acknowledgeKioskSetup()"
      />
      <div
        class="mt-3 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-left"
        role="note"
      >
        <ExclamationTriangleIcon class="mt-0.5 h-4 w-4 shrink-0 text-warning-dark" aria-hidden="true" />
        <p class="text-xs leading-relaxed text-warning-dark">
          Without kiosk mode, silent printing may not work as expected.
        </p>
      </div>
    </div>
  </div>
  <div
    v-else
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

    <div class="grid min-h-0 flex-1 gap-5 lg:grid-cols-2">
      <section class="card flex min-h-0 flex-col overflow-hidden p-5 sm:p-6">
        <p class="section-title mb-4 shrink-0">QR scanner</p>
        <div class="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto">
        <QRCamera
          qr-type="eventyaycheckin"
          :scan-type="isBadgeStation ? 'Badge' : 'Check-In'"
          :keep-active="shouldAutoPrintBadge"
        />

        <div
          v-if="isBadgeStation"
          class="mt-5 flex items-center justify-between rounded-xl border border-surface-border bg-surface-muted px-4 py-3"
        >
          <div>
            <p class="text-sm font-semibold text-body">Auto-print badge</p>
            <p class="text-xs text-body-muted">Prints immediately after each scan.</p>
          </div>
          <button
            type="button"
            class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-300 ease-in-out items-center focus:outline-none focus:ring-2 focus:ring-primary/20"
            :class="autoPrintBadge ? 'bg-primary' : 'bg-[#E9E9EB]'"
            role="switch"
            :aria-checked="autoPrintBadge"
            @click="autoPrintBadge = !autoPrintBadge"
          >
            <!-- Accessibility On Label (Line) -->
            <span
              class="absolute left-2.5 h-2.5 w-0.5 rounded-full bg-white transition-opacity duration-300"
              :class="autoPrintBadge ? 'opacity-100' : 'opacity-0'"
            />
            <!-- Accessibility Off Label (Circle) -->
            <span
              class="absolute right-2 h-2 w-2 rounded-full border border-body-light transition-opacity duration-300"
              :class="autoPrintBadge ? 'opacity-0' : 'opacity-100'"
            />
            <!-- Slider Handle -->
            <span
              aria-hidden="true"
              class="relative inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-300 ease-in-out z-10"
              :class="autoPrintBadge ? 'translate-x-5' : 'translate-x-0'"
            />
          </button>
        </div>

        <div
          v-if="isBadgeStation && autoPrintFeedback"
          class="mt-3 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          :class="{
            'border-primary/20 bg-primary/5 text-body': autoPrintFeedback.status === 'printing',
            'border-success/20 bg-success/5 text-success-dark': autoPrintFeedback.status === 'success',
            'border-danger/20 bg-danger/5 text-danger': autoPrintFeedback.status === 'error'
          }"
          role="status"
          aria-live="polite"
        >
          <span
            v-if="autoPrintFeedback.status === 'printing'"
            class="mt-0.5 inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
            aria-hidden="true"
          />
          <p class="leading-snug">{{ autoPrintFeedback.text }}</p>
        </div>
        </div>
      </section>

      <section class="card flex min-h-0 flex-col overflow-hidden p-5 sm:p-6">
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
                  :variant="isCheckedIn(order) && !isBadgeStation ? 'white' : 'success'"
                  size="sm"
                  :disabled="isAttendeeActionDisabled(order)"
                  @click="checkIn(order)"
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
              :text="isRegistering ? 'Registering...' : 'Register & check in'"
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
              :text="isSavingAttendee ? 'Saving...' : 'Save & check in'"
              variant="primary"
              :disabled="isSavingAttendee"
              @click="saveAttendeeAndCheckIn"
            />
          </div>
        </div>
      </div>
    </Transition>

    <AttendeeInfoModal
      v-if="showAttendeeModal && message?.attendee"
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
      @customize-badge="handleCustomizeBadge"
      @exit="handleExitFromModal"
      @checkin="handleCheckInAfterCheckout"
      @close="closePopup"
      @timeout="closePopup"
    />

    <BadgeCustomizeModal
      v-if="badgeCustomizeRequest"
      :fields="badgeCustomizeRequest.customization.fields"
      :hidden-fields="badgeCustomizeRequest.customization.hidden_fields || []"
      @confirm="resolveBadgeCustomization"
      @cancel="cancelBadgeCustomization"
    />

    <BadgePrintPreview
      v-if="showPrintPreview && badgeUrl"
      :badge-path="badgeUrl"
      @close="handlePrintClose"
    />
  </div>
  </div>
</template>

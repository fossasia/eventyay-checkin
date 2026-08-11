import { useCameraStore } from '@/stores/camera'
import { useEventyayApi } from '@/stores/eventyayapi'
import {
  buildCheckInListCacheKey,
  createCheckInListCache,
  createCheckInListRequestCoordinator,
  createEmptyCheckInListCache,
  isCheckInListCacheEntryValid,
  shouldRetryCheckInWithFreshLists
} from '@/utils/checkInListCache'
import { createAuthorizedDeviceApi, normalizeApiResourcePath } from '@/utils/serverUrl'
import { DEVICE_PROFILE_DENIED_MESSAGE, getDeviceErrorMessage, handleDeviceApiError } from '@/utils/deviceErrors'
import { fetchBadgePdfWithRetry, printPdfBlob, PRINT_OUTCOME, withBadgeLayoutParam } from '@/utils/badgePdf'
import { isBadgeCustomizationUnchanged, parseBadgeCustomizationResult } from '@/utils/badgeCustomization'
import { shouldUseSilentPrint } from '@/utils/kioskLauncher'
import { parseQrPayload } from '@/utils/session'
import { useCheckinSettingsStore } from '@/stores/checkinSettings'

import { defineStore } from 'pinia'
import { ref } from 'vue'

const AUTO_PRINT_COSMETIC_MS = 1000
const AUTO_PRINT_ERROR_MS = 3000

export const useProcessEventyayCheckInStore = defineStore('processEventyayCheckIn', () => {
  const cameraStore = useCameraStore()
  const checkinSettings = useCheckinSettingsStore()
  const message = ref(null)
  const showSuccess = ref(false)
  const showError = ref(false)
  const badgeUrl = ref('')
  const badgeAssignedLayoutId = ref(null)
  const badgeLayouts = ref([])
  const isGeneratingBadge = ref(false)
  const checkInListCache = ref(createEmptyCheckInListCache())
  const checkInListRequestCoordinator = createCheckInListRequestCoordinator()
  const autoPrintFeedback = ref(null)
  let autoPrintFeedbackTimer = null
  const badgeCustomizeRequest = ref(null)
  const autoPrintCustomizeOnce = ref(false)
  // Full list objects for the UI picker (populated after fetch)
  const availableCheckInLists = ref([])

  function getEventListContext() {
    const processApi = useEventyayApi()
    const organizer = processApi.organizer
    const eventSlug = processApi.eventSlug
    const apitoken = processApi.apitoken
    const url = processApi.url
    const limitCheckInLists = processApi.limitCheckInLists
    const cacheKey = buildCheckInListCacheKey(organizer, eventSlug)

    return {
      processApi,
      organizer,
      eventSlug,
      apitoken,
      url,
      limitCheckInLists,
      cacheKey,
      isReady: Boolean(organizer && eventSlug && apitoken && url),
      hasCachedLists: isCheckInListCacheEntryValid(checkInListCache.value, cacheKey)
    }
  }

  function invalidateCheckInListCache() {
    checkInListCache.value = createEmptyCheckInListCache()
    checkInListRequestCoordinator.reset()
  }

  async function fetchAndStoreCheckInLists(cacheKey, eventSlugOverride = null) {
    const { processApi } = getEventListContext()
    const apitoken = processApi.apitoken
    const url = processApi.url
    const organizer = processApi.organizer
    const eventSlug = eventSlugOverride || processApi.eventSlug
    const limitCheckInLists = processApi.limitCheckInLists

    return checkInListRequestCoordinator.run(cacheKey, async () => {
      const api = createAuthorizedDeviceApi(url, apitoken)
      const response = await api.get(
        `/api/v1/organizers/${organizer}/events/${eventSlug}/checkinlists/`
      )

      let lists = Array.isArray(response) ? response : (response?.results || [])

      // When the device is restricted to specific check-in lists, filter to only those
      if (limitCheckInLists && limitCheckInLists.length > 0) {
        const allowedIds = new Set(limitCheckInLists.map(Number))
        lists = lists.filter((l) => allowedIds.has(Number(l.id)))
      }

      // Store the full list objects for the UI picker
      availableCheckInLists.value = lists

      const listIds = lists.map((list) => list.id.toString())
      checkInListCache.value = createCheckInListCache(cacheKey, listIds)

      return listIds
    })
  }

  async function getCheckInLists({ force = false, eventSlug: eventSlugOverride = null } = {}) {
    const { processApi, cacheKey, isReady } = getEventListContext()
    const fetchSlug = eventSlugOverride || processApi.eventSlug

    if (!processApi.organizer || !processApi.apitoken || !processApi.url || !fetchSlug) {
      return []
    }

    const effectiveCacheKey = eventSlugOverride ? `${cacheKey}:${eventSlugOverride}` : cacheKey

    if (!force && isCheckInListCacheEntryValid(checkInListCache.value, effectiveCacheKey)) {
      return checkInListCache.value.listIds
    }

    try {
      return await fetchAndStoreCheckInLists(effectiveCacheKey, fetchSlug)
    } catch (err) {
      handleDeviceApiError(err, processApi)
      throw err
    }
  }

  function refreshCheckInListsInBackground() {
    const { isReady, hasCachedLists } = getEventListContext()

    if (!isReady || !hasCachedLists) {
      return
    }

    getCheckInLists({ force: true }).catch((error) => {
      console.error('Background check-in list refresh failed:', error)
    })
  }

  async function prefetchCheckInLists() {
    try {
      await getCheckInLists()
    } catch (error) {
      console.error('Failed to prefetch check-in lists:', error)
    }
  }

  async function reloadCheckInListsForCurrentEvent() {
    invalidateCheckInListCache()
    await prefetchCheckInLists()
  }

  function $reset() {
    message.value = null
    showSuccess.value = false
    showError.value = false
    badgeUrl.value = ''
    badgeAssignedLayoutId.value = null
    isGeneratingBadge.value = false
  }

  function isAutoPrintEnabled() {
    const { processApi } = getEventListContext()
    return checkinSettings.isAutoPrintActive(processApi.selectedRole)
  }

  function clearAutoPrintFeedback() {
    if (autoPrintFeedbackTimer) {
      clearTimeout(autoPrintFeedbackTimer)
      autoPrintFeedbackTimer = null
    }
    autoPrintFeedback.value = null
  }

  function showAutoPrintFeedback(status, text, durationMs) {
    autoPrintFeedback.value = { status, text }
    if (autoPrintFeedbackTimer) {
      clearTimeout(autoPrintFeedbackTimer)
      autoPrintFeedbackTimer = null
    }
    if (!durationMs || durationMs <= 0) {
      return
    }
    autoPrintFeedbackTimer = setTimeout(() => {
      autoPrintFeedback.value = null
      autoPrintFeedbackTimer = null
    }, durationMs)
  }

  function queueBadgePrint(badgeUrlPath) {
    void (async () => {
      try {
        const badgeResult = await getBadgeBlob(badgeUrlPath)
        if (!badgeResult?.blob) {
          console.warn('Badge print skipped:', badgeResult?.detail)
          return
        }
        void printPdfBlob(badgeResult.blob, { silent: shouldUseSilentPrint() })
      } catch (error) {
        console.warn('Background badge print failed:', error)
      }
    })()
  }

  async function runAutoPrintAfterCheckIn(badgeUrlPath, position) {
    const attendeeLabel = position?.attendee_name || 'attendee'

    if (!badgeUrlPath) {
      showAutoPrintFeedback('error', `No badge available for ${attendeeLabel}.`, AUTO_PRINT_ERROR_MS)
      return false
    }

    const customization = position?.badge_customization
    const shouldCustomize =
      autoPrintCustomizeOnce.value &&
      customization?.allow_customization &&
      customization.fields?.length

    if (shouldCustomize) {
      try {
        const customizationResult = await requestBadgeCustomization(customization, {
          positionId: position?.id,
          badgeUrlPath
        })
        if (position?.id) {
          await saveBadgeCustomization(position.id, customizationResult, customization)
        }
      } catch (error) {
        if (error?.message === 'cancelled') {
          clearAutoPrintFeedback()
          cameraStore.clearLastScan()
          return false
        }
        throw error
      }
      autoPrintCustomizeOnce.value = false
    }

    showAutoPrintFeedback('printing', `Printing badge for ${attendeeLabel}…`, AUTO_PRINT_COSMETIC_MS)
    queueBadgePrint(badgeUrlPath)
    cameraStore.clearLastScan()
    return true
  }

  function showErrorMsg(msg) {
    if (isAutoPrintEnabled()) {
      showAutoPrintFeedback('error', msg?.message || 'Check-in failed.', AUTO_PRINT_ERROR_MS)
      return
    }
    message.value = msg
    showSuccess.value = false
    showError.value = true
  }

  function showCheckoutRequiredMsg(msg) {
    if (isAutoPrintEnabled()) {
      showAutoPrintFeedback('error', msg?.message || 'Check-out required.', AUTO_PRINT_ERROR_MS)
      return
    }
    message.value = { ...msg, checkoutRequired: true }
    showSuccess.value = false
    showError.value = true
  }

  function showOfferCheckInMsg(msg) {
    message.value = { ...msg, offerCheckInAtGate: true }
    showSuccess.value = true
    showError.value = false
  }

  function showSuccessMsg(msg) {
    message.value = msg
    showSuccess.value = true
    showError.value = false
  }

  function buildAttendeeMessage(messageText, position, secret = '', hints = {}) {
    return {
      message: messageText,
      attendee: position?.attendee_name || hints.attendee_name || '',
      attendee_name: position?.attendee_name || hints.attendee_name || '',
      attendee_email: position?.attendee_email || hints.attendee_email || '',
      product_id: position?.product || null,
      variation: position?.variation || null,
      company: position?.company || hints.company || '',
      job_title: position?.job_title || hints.job_title || '',
      answers: position?.answers || hints.answers || [],
      orderPositionId: position?.id || null,
      secret,
      alreadyCheckedIn: Boolean(hints.alreadyCheckedIn),
      checkedOut: Boolean(hints.checkedOut),
      checkoutRequired: Boolean(hints.checkoutRequired),
      crossGateCheckout: Boolean(hints.crossGateCheckout),
      offerCheckInAtGate: Boolean(hints.offerCheckInAtGate),
      manualReprintOnly: Boolean(hints.manualReprintOnly),
      errorReason: hints.errorReason || null,
      errorLabel: hints.errorLabel || '',
      positionCanceled: Boolean(hints.positionCanceled),
      orderCanceled: Boolean(hints.orderCanceled),
      simpleError: Boolean(hints.simpleError),
      submessage: hints.submessage || '',
      validityWindow: hints.validityWindow || '',
      admission_valid_from: position?.admission_valid_from || hints.admission_valid_from || null,
      admission_valid_until: position?.admission_valid_until || hints.admission_valid_until || null,
      badge_customization: position?.badge_customization || hints.badge_customization || null
    }
  }

  function hasKnownAttendee(position, hints = {}) {
    if (position?.id) {
      return true
    }
    return Boolean(String(hints.attendee_name || position?.attendee_name || '').trim())
  }

  function showSimpleScanError(messageText, secret, hints = {}) {
    showErrorMsg(
      buildAttendeeMessage('', null, secret, {
        ...hints,
        errorReason: hints.errorReason || 'invalid',
        errorLabel: messageText,
        simpleError: true
      })
    )
  }

  function getCheckInResultMessage(status) {
    const alreadyCheckedIn = status === 'redeemed'
    if (alreadyCheckedIn) {
      return ''
    }
    return 'Check-in successful!'
  }

  function generateNonce(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  function getSelectedCheckInList() {
    const { processApi } = getEventListContext()
    const selectedId = processApi.selectedCheckInListId
    if (selectedId) {
      return availableCheckInLists.value.find((list) => String(list.id) === String(selectedId)) || null
    }
    return availableCheckInLists.value[0] || null
  }

  function printedBadgeStorageKey() {
    const { organizer, eventSlug } = getEventListContext()
    return `eventyay-printed-badges-${organizer}-${eventSlug}`
  }

  function hasPrintedBadge(positionId) {
    if (!positionId || typeof window === 'undefined') {
      return false
    }
    try {
      const printedIds = JSON.parse(sessionStorage.getItem(printedBadgeStorageKey()) || '[]')
      return printedIds.includes(Number(positionId))
    } catch {
      return false
    }
  }

  function markPrintedBadge(positionId) {
    if (!positionId || typeof window === 'undefined') {
      return
    }
    try {
      const printedIds = new Set(JSON.parse(sessionStorage.getItem(printedBadgeStorageKey()) || '[]'))
      printedIds.add(Number(positionId))
      sessionStorage.setItem(printedBadgeStorageKey(), JSON.stringify([...printedIds]))
    } catch {
      sessionStorage.setItem(printedBadgeStorageKey(), JSON.stringify([Number(positionId)]))
    }
  }

  function isCanceledPosition(position) {
    if (!position) {
      return false
    }
    if (position.canceled) {
      return true
    }
    const orderStatus = String(position.order__status || position.order?.status || '').toLowerCase()
    return orderStatus === 'c'
  }

  function getCanceledPresentation(position, explanation = '') {
    const detail = String(explanation || '').trim()
    if (position?.canceled) {
      return {
        errorLabel: 'Ticket canceled',
        message: detail || 'This ticket has been canceled and cannot be used for check-in.',
        positionCanceled: true,
        orderCanceled: false
      }
    }
    const orderStatus = String(position?.order__status || position?.order?.status || '').toLowerCase()
    if (orderStatus === 'c') {
      return {
        errorLabel: 'Order canceled',
        message: detail || 'This order was canceled. Check-in is not allowed.',
        positionCanceled: false,
        orderCanceled: true
      }
    }
    return {
      errorLabel: 'Ticket canceled',
      message: detail || 'This ticket cannot be checked in because it was canceled.',
      positionCanceled: isCanceledPosition(position),
      orderCanceled: orderStatus === 'c'
    }
  }

  function getRedeemErrorReason(response) {
    if (!response || typeof response !== 'object') {
      return null
    }

    const reason = String(response.reason || '').trim()
    const explanation = String(response.reason_explanation || response.detail || '').trim()
    const lowerExplanation = explanation.toLowerCase()
    const knownReasons = new Set([
      'invalid',
      'invalid_time',
      'already_redeemed',
      'checkout_required',
      'ambiguous',
      'revoked',
      'product',
      'subevent',
      'unpaid',
      'rules',
      'canceled'
    ])
    if (knownReasons.has(reason)) {
      return reason
    }

    const lowerReason = reason.toLowerCase()
    if (lowerReason.includes('invalid product')) {
      return 'product'
    }
    if (lowerReason.includes('invalid date')) {
      return 'subevent'
    }
    if (lowerReason.includes('not marked as paid')) {
      return 'unpaid'
    }
    if (lowerReason.includes('custom rules')) {
      return 'rules'
    }
    if (lowerReason.includes('already been redeemed')) {
      return 'already_redeemed'
    }
    if (lowerExplanation.includes('cancel')) {
      return 'canceled'
    }

    return reason || null
  }

  function getRedeemErrorPresentation(response) {
    if (!response || typeof response !== 'object') {
      return { errorLabel: '', message: '' }
    }

    const reason = getRedeemErrorReason(response)
    const explanation = String(response.reason_explanation || '').trim()
    const lowerExplanation = explanation.toLowerCase()

    if (reason === 'checkout_required') {
      return {
        errorLabel: 'Check-out required',
        message:
          explanation ||
          'This attendee must check out before they can check in here again.'
      }
    }
    if (reason === 'rules') {
      return {
        errorLabel: 'Check-in blocked',
        message: explanation || 'Custom rules prevent check-in for this ticket.'
      }
    }
    if (reason === 'invalid_time') {
      const position = response.position
      const now = Date.now()
      if (position?.admission_valid_from) {
        const fromMs = new Date(position.admission_valid_from).getTime()
        if (!Number.isNaN(fromMs) && fromMs > now) {
          return { errorLabel: 'Ticket not yet valid', message: 'This ticket is not valid yet.' }
        }
      }
      if (position?.admission_valid_until) {
        const untilMs = new Date(position.admission_valid_until).getTime()
        if (!Number.isNaN(untilMs) && untilMs < now) {
          return { errorLabel: 'Ticket no longer valid', message: 'This ticket is no longer valid.' }
        }
      }
      if (lowerExplanation.includes('not valid yet')) {
        return { errorLabel: 'Ticket not yet valid', message: explanation || 'This ticket is not valid yet.' }
      }
      if (lowerExplanation.includes('no longer valid')) {
        return {
          errorLabel: 'Ticket no longer valid',
          message: explanation || 'This ticket is no longer valid.'
        }
      }
      return { errorLabel: 'Ticket not valid', message: 'This ticket is not valid at this time.' }
    }
    if (reason === 'product') {
      if (lowerExplanation.includes('does not grant admission')) {
        return {
          errorLabel: 'Not an entry ticket',
          message:
            explanation ||
            'This product does not grant admission. Only event tickets can be checked in.'
        }
      }
      return {
        errorLabel: 'Wrong check-in list',
        message:
          explanation ||
          'This ticket type is not accepted at this check-in list. Try another list or gate.'
      }
    }
    if (reason === 'subevent') {
      return {
        errorLabel: 'Wrong session',
        message:
          explanation ||
          'This ticket is for a different date or session. Use the matching check-in list.'
      }
    }
    if (reason === 'unpaid') {
      if (lowerExplanation.includes('cancel') || isCanceledPosition(response.position)) {
        return getCanceledPresentation(response.position, explanation)
      }
      return {
        errorLabel: 'Payment required',
        message: explanation || 'This order has not been paid yet.'
      }
    }
    if (reason === 'canceled') {
      return getCanceledPresentation(response.position, explanation)
    }
    if (reason === 'invalid') {
      return {
        errorLabel: 'This code is not valid for this event.',
        message: '',
        simpleError: true
      }
    }
    if (reason === 'revoked') {
      return {
        errorLabel: 'Ticket revoked',
        message:
          explanation ||
          'This code was revoked or replaced. Scan the current ticket from the order confirmation.'
      }
    }
    if (reason === 'ambiguous') {
      return {
        errorLabel: 'Ambiguous scan',
        message: explanation || 'Multiple tickets match this code. Try a more specific scan.'
      }
    }
    if (reason === 'already_redeemed') {
      return {
        errorLabel: 'Already checked in',
        message: explanation || 'This ticket has already been checked in.'
      }
    }

    return {
      errorLabel: '',
      message: explanation || String(response.detail || '').trim() || 'Check-in failed.'
    }
  }

  function getRedeemErrorMessage(response) {
    return getRedeemErrorPresentation(response).message
  }

  function getRedeemErrorResponse(error) {
    let body = error?.body ?? error?.response?.data ?? error?.cause?.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        body = body.trim() ? { detail: body } : null
      }
    }
    if (body && typeof body === 'object') {
      if (body.status === 'error' || body.reason) {
        return body
      }
      const status = error?.response?.status ?? error?.status
      if (status === 404) {
        return {
          status: 'error',
          reason: 'invalid',
          reason_explanation: body.reason_explanation || null,
          detail: body.detail || null,
          position: body.position || null
        }
      }
    }
    const status = error?.response?.status ?? error?.status
    if (status === 404) {
      return { status: 'error', reason: 'invalid', reason_explanation: null }
    }
    return null
  }

  function isRedeemNetworkError(error) {
    const status = error?.response?.status ?? error?.status
    if (status) {
      return false
    }
    const message = String(error?.message || '').toLowerCase()
    return (
      error instanceof TypeError ||
      message.includes('failed to fetch') ||
      message.includes('networkerror') ||
      message.includes('network request failed')
    )
  }

  function setBadgeUrlFromPosition(position) {
    const badgeDownload = position?.downloads?.find((download) => download.output === 'badge')
    badgeUrl.value = normalizeApiResourcePath(badgeDownload?.url || '')
    badgeAssignedLayoutId.value =
      badgeDownload?.layout != null && badgeDownload?.layout !== ''
        ? Number(badgeDownload.layout)
        : null
  }

  async function fetchBadgeLayouts({ force = false } = {}) {
    const { organizer, eventSlug, url, apitoken, isReady } = getEventListContext()
    if (!isReady) {
      return []
    }
    if (!force && badgeLayouts.value.length) {
      return badgeLayouts.value
    }

    try {
      const api = createAuthorizedDeviceApi(url, apitoken, { Accept: 'application/json' })
      const response = await api.get(
        `/api/v1/organizers/${organizer}/events/${eventSlug}/badgelayouts/`
      )
      const results = Array.isArray(response) ? response : response?.results || []
      badgeLayouts.value = results
        .map((layout) => ({
          id: layout.id,
          name: layout.name || `Layout ${layout.id}`,
          default: Boolean(layout.default)
        }))
        .sort((a, b) => Number(b.default) - Number(a.default) || String(a.name).localeCompare(String(b.name)))
      return badgeLayouts.value
    } catch (error) {
      console.warn('Unable to load badge layouts:', error)
      return badgeLayouts.value
    }
  }

  function showCanceledAttendeeFromSearch(order, hints = {}) {
    const presentation = getCanceledPresentation(order)
    showErrorMsg(
      buildAttendeeMessage(presentation.message, order, order.secret, {
        attendee_name: order.attendee_name,
        attendee_email: order.attendee_email,
        company: order.company,
        job_title: order.job_title,
        product_id: order.product,
        variation: order.variation,
        errorReason: 'canceled',
        errorLabel: presentation.errorLabel,
        positionCanceled: presentation.positionCanceled,
        orderCanceled: presentation.orderCanceled,
        ...hints
      })
    )
  }

  function handleRedeemErrorResponse(response, normalizedSecret, hints) {
    const reason = getRedeemErrorReason(response)
    const presentation = getRedeemErrorPresentation(response)
    const errorHints = {
      ...hints,
      errorReason: reason,
      errorLabel: presentation.errorLabel,
      positionCanceled: Boolean(presentation.positionCanceled),
      orderCanceled: Boolean(presentation.orderCanceled),
      simpleError: Boolean(presentation.simpleError)
    }
    if (reason === 'invalid_time' && response.reason_explanation) {
      const explanation = String(response.reason_explanation).trim()
      const lower = explanation.toLowerCase()
      const looksLikeWindow =
        explanation.includes('–') ||
        (/\d/.test(explanation) &&
          !lower.includes('not valid yet') &&
          !lower.includes('no longer valid'))
      if (looksLikeWindow) {
        errorHints.validityWindow = explanation
      }
    }
    const msg = buildAttendeeMessage(
      presentation.message || 'Check-in failed!',
      response?.position,
      normalizedSecret,
      errorHints
    )
    if (reason === 'checkout_required' && response.cross_gate) {
      showCheckoutRequiredMsg({
        ...msg,
        crossGateCheckout: true,
      })
    } else if (reason === 'checkout_required') {
      setBadgeUrlFromPosition(response?.position)
      showSuccessMsg({
        ...msg,
        alreadyCheckedIn: true,
        message: '',
      })
    } else if (reason === 'already_redeemed') {
      setBadgeUrlFromPosition(response?.position)
      showSuccessMsg({
        ...msg,
        alreadyCheckedIn: true,
        message: '',
      })
    } else if (presentation.simpleError || (reason === 'invalid' && !hasKnownAttendee(response?.position, hints))) {
      showSimpleScanError(
        presentation.errorLabel || presentation.message || 'This code is not valid for this event.',
        normalizedSecret,
        errorHints
      )
    } else {
      showErrorMsg(msg)
    }
  }

  async function redeemBySecret(secret, { type = 'entry', attendeeHints = null, isRetry = false, suppressSuccess = false } = {}) {
    const hints = attendeeHints || {}
    const normalizedSecret = String(secret || '').trim()
    if (!normalizedSecret) {
      showErrorMsg(buildAttendeeMessage('Check-in failed!', null, normalizedSecret))
      return null
    }

    const { processApi, apitoken, url, organizer } = getEventListContext()

    if (!url || !apitoken || !organizer) {
      showErrorMsg(buildAttendeeMessage('Device is not configured for check-in.', null, normalizedSecret))
      return null
    }

    try {
      const checkInLists = await getCheckInLists({ force: true })

      if (!checkInLists.length) {
        showErrorMsg(
          buildAttendeeMessage('No check-in lists are configured for this event.', null, normalizedSecret)
        )
        return null
      }

      const selectedList = getSelectedCheckInList()
      if (!selectedList?.id) {
        showErrorMsg(
          buildAttendeeMessage('No check-in lists are configured for this event.', null, normalizedSecret)
        )
        return null
      }

      if (String(processApi.selectedCheckInListId) !== String(selectedList.id)) {
        processApi.setSelectedCheckInListId(selectedList.id)
      }

      const listsToUse = [Number(selectedList.id)]
      const api = createAuthorizedDeviceApi(url, apitoken, { Accept: 'application/json' })
      const checkInNonce = generateNonce()

      const response = await api.post(`/api/v1/organizers/${organizer}/checkin/redeem/`, {
        secret: normalizedSecret,
        source_type: 'barcode',
        lists: listsToUse,
        type,
        force: false,
        ignore_unpaid: false,
        nonce: checkInNonce,
        datetime: null,
        questions_supported: false
      })

      if (response && (response.status === 'ok' || response.status === 'redeemed')) {
        if (type === 'exit') {
          if (!suppressSuccess) {
            showSuccessMsg(
              buildAttendeeMessage('Checked out successfully', response.position, normalizedSecret, {
                ...hints,
                checkedOut: true
              })
            )
          }
          return response
        }

        setBadgeUrlFromPosition(response.position)
        const isBadgeStation = processApi.selectedRole === 'Badge Station'
        const alreadyCheckedIn = response.status === 'redeemed'
        const positionId = response.position?.id

        if (isBadgeStation && isAutoPrintEnabled() && !alreadyCheckedIn) {
          const printed = await runAutoPrintAfterCheckIn(badgeUrl.value, response.position)
          if (printed) {
            markPrintedBadge(positionId)
          }
          return response
        }

        if (isBadgeStation && alreadyCheckedIn) {
          showSuccessMsg(
            buildAttendeeMessage(
              getCheckInResultMessage(response.status),
              response.position,
              normalizedSecret,
              { ...hints, alreadyCheckedIn: true, manualReprintOnly: true }
            )
          )
          return response
        }

        const resultMessage = getCheckInResultMessage(response.status)
        const resultHints = {
          ...hints,
          alreadyCheckedIn,
          submessage:
            isBadgeStation && !alreadyCheckedIn && badgeUrl.value ? 'Badge ready' : ''
        }

        showSuccessMsg(
          buildAttendeeMessage(resultMessage, response.position, normalizedSecret, resultHints)
        )
      } else if (response?.status === 'error') {
        handleRedeemErrorResponse(response, normalizedSecret, hints)
      } else {
        showErrorMsg(
          buildAttendeeMessage('Check-in failed!', response?.position, normalizedSecret, hints)
        )
      }

      return response
    } catch (error) {
      console.error('Fetch error:', error)
      if (
        handleDeviceApiError(error, processApi, {
          onProfileDenied: (msg) =>
            showErrorMsg(buildAttendeeMessage(msg, null, normalizedSecret, hints))
        })
      ) {
        return null
      }

      if (!isRetry && shouldRetryCheckInWithFreshLists(error)) {
        invalidateCheckInListCache()
        return redeemBySecret(normalizedSecret, { type, isRetry: true, attendeeHints: hints })
      }

      const redeemError = getRedeemErrorResponse(error)
      if (redeemError) {
        handleRedeemErrorResponse(redeemError, normalizedSecret, hints)
        return redeemError
      }

      const status = error?.response?.status ?? error?.status
      const fallbackMessage = isRedeemNetworkError(error)
        ? 'Check-in failed. Check your connection and try again.'
        : getDeviceErrorMessage(
            error,
            status === 400
              ? 'Check-in failed. Verify the active check-in list in Configure and try again.'
              : 'This code is not valid for this event.',
            { hideHttpStatusText: true }
          )
      showSimpleScanError(fallbackMessage, normalizedSecret, {
        ...hints,
        errorReason: 'invalid'
      })
      return null
    }
  }

  async function getBadgeBlob(badgeUrlPath, { layoutId = null } = {}) {
    const { apitoken, url } = getEventListContext()

    if (!url || !apitoken || !badgeUrlPath) {
      return null
    }

    const pathWithLayout = withBadgeLayoutParam(badgeUrlPath, layoutId)
    const result = await fetchBadgePdfWithRetry(pathWithLayout, { baseUrl: url, apitoken })
    if (result.status === 'ready') {
      return { blob: result.blob }
    }
    if (result.profileDenied) {
      return { profileDenied: true, detail: result.detail || DEVICE_PROFILE_DENIED_MESSAGE }
    }
    return {
      detail:
        result.detail ||
        (result.status === 'generating'
          ? 'Badge is still generating. Ensure a Celery worker is running and try again.'
          : 'Could not load the badge PDF.')
    }
  }

  async function saveBadgeCustomization(positionId, result, customization = null) {
    const { organizer, eventSlug, url, apitoken } = getEventListContext()
    if (!organizer || !eventSlug || !url || !apitoken || !positionId) {
      return false
    }

    const sourceCustomization =
      customization || badgeCustomizeRequest.value?.customization || null
    if (sourceCustomization && isBadgeCustomizationUnchanged(sourceCustomization, result)) {
      return false
    }

    const hiddenFields = Array.isArray(result) ? result : result.hiddenFields
    const payload = { badge_hidden_fields: hiddenFields }
    if (!Array.isArray(result) && result.fieldOverrides) {
      payload.badge_field_overrides = result.fieldOverrides
    }

    const api = createAuthorizedDeviceApi(url, apitoken, { Accept: 'application/json' })
    await api.patch(
      `/api/v1/organizers/${organizer}/events/${eventSlug}/orderpositions/${positionId}/`,
      payload
    )
    return true
  }

  function requestBadgeCustomization(
    customization,
    {
      positionId = null,
      badgeUrlPath = '',
      editMode = false,
      layouts = [],
      initialLayoutId = null
    } = {}
  ) {
    return new Promise((resolve, reject) => {
      badgeCustomizeRequest.value = {
        customization: customization || {
          allow_customization: false,
          allow_badge_editing: false,
          fields: [],
          hidden_fields: [],
          field_overrides: {}
        },
        positionId,
        badgeUrlPath: badgeUrlPath || badgeUrl.value || '',
        editMode,
        layouts: Array.isArray(layouts) ? layouts : [],
        initialLayoutId:
          initialLayoutId != null && initialLayoutId !== ''
            ? initialLayoutId
            : badgeAssignedLayoutId.value,
        resolve,
        reject
      }
    })
  }

  function resolveBadgeCustomization(result) {
    badgeCustomizeRequest.value?.resolve(result)
    badgeCustomizeRequest.value = null
  }

  function cancelBadgeCustomization() {
    badgeCustomizeRequest.value?.reject(new Error('cancelled'))
    badgeCustomizeRequest.value = null
  }

  async function previewBadgeCustomization(result) {
    const request = badgeCustomizeRequest.value
    if (!request?.badgeUrlPath) {
      throw new Error('No badge is available to preview.')
    }
    const hasFields = Boolean(
      request.customization?.allow_customization && request.customization.fields?.length
    )
    if (request.positionId && hasFields) {
      await saveBadgeCustomization(request.positionId, result, request.customization)
    }
    const { layoutId } = parseBadgeCustomizationResult(result)
    return withBadgeLayoutParam(request.badgeUrlPath, layoutId)
  }

  async function openBadgeCustomization(
    customization,
    positionId,
    {
      badgeUrlPath = '',
      editMode = false,
      layouts = [],
      initialLayoutId = null,
      requirePrompt = false
    } = {}
  ) {
    const hasFields = Boolean(customization?.allow_customization && customization.fields?.length)
    const hasLayouts = Array.isArray(layouts) && layouts.length > 0
    if (editMode && !hasFields) {
      return null
    }
    if (!editMode && !hasFields && !(requirePrompt && hasLayouts)) {
      return null
    }

    try {
      const customizationResult = await requestBadgeCustomization(customization, {
        positionId,
        badgeUrlPath,
        editMode,
        layouts: editMode ? [] : layouts,
        initialLayoutId
      })
      if (positionId && hasFields) {
        await saveBadgeCustomization(positionId, customizationResult, customization)
      }
      return customizationResult
    } catch (error) {
      if (error?.message === 'cancelled') {
        return null
      }
      throw error
    }
  }

  async function printBadgeWithOptionalCustomization(
    badgeUrlPath,
    position,
    { silent = false, customize = false } = {}
  ) {
    const customization = position?.badge_customization
    let layoutId = null
    if (customize && customization?.allow_customization && customization.fields?.length) {
      try {
        const customizationResult = await requestBadgeCustomization(customization, {
          positionId: position?.id,
          badgeUrlPath
        })
        if (position?.id) {
          await saveBadgeCustomization(position.id, customizationResult, customization)
        }
        layoutId = parseBadgeCustomizationResult(customizationResult).layoutId
      } catch (error) {
        if (error?.message === 'cancelled') {
          return PRINT_OUTCOME.CANCELLED
        }
        throw error
      }
    }
    return printBadge(badgeUrlPath, { silent, layoutId })
  }

  async function printBadge(badgeUrlPath, { silent = false, layoutId = null } = {}) {
    if (!badgeUrlPath) {
      return PRINT_OUTCOME.FAILED
    }

    isGeneratingBadge.value = true

    try {
      const badgeResult = await getBadgeBlob(badgeUrlPath, { layoutId })
      if (badgeResult?.profileDenied) {
        showErrorMsg(buildAttendeeMessage(badgeResult.detail, null))
        return PRINT_OUTCOME.FAILED
      }
      if (!badgeResult?.blob) {
        showErrorMsg(
          buildAttendeeMessage(
            badgeResult?.detail || 'Could not load the badge PDF.',
            null
          )
        )
        return PRINT_OUTCOME.FAILED
      }

      const useSilentPrint = silent && shouldUseSilentPrint()
      return await printPdfBlob(badgeResult.blob, { silent: useSilentPrint })
    } catch (error) {
      console.error('Error printing badge:', error)
      return PRINT_OUTCOME.FAILED
    } finally {
      isGeneratingBadge.value = false
    }
  }

  async function checkInBySecret(secret, options = {}) {
    return redeemBySecret(secret, { ...options, type: 'entry' })
  }

  async function checkOutBySecret(secret, options = {}) {
    return redeemBySecret(secret, { ...options, type: 'exit' })
  }

  async function checkIn() {
    try {
      const secret = parseQrPayload(cameraStore.qrCodeValue, 'ticket')
      return await checkInBySecret(secret)
    } catch (error) {
      console.error('Invalid QR payload:', error)
      showErrorMsg(buildAttendeeMessage('Check-in Failed!', null))
      return null
    } finally {
      cameraStore.clearLastScan()
    }
  }

  return {
    message,
    showSuccess,
    showError,
    badgeUrl,
    badgeAssignedLayoutId,
    badgeLayouts,
    isGeneratingBadge,
    availableCheckInLists,
    autoPrintFeedback,
    badgeCustomizeRequest,
    autoPrintCustomizeOnce,
    checkIn,
    checkInBySecret,
    checkOutBySecret,
    getSelectedCheckInList,
    hasPrintedBadge,
    markPrintedBadge,
    printBadge,
    printBadgeWithOptionalCustomization,
    resolveBadgeCustomization,
    cancelBadgeCustomization,
    previewBadgeCustomization,
    openBadgeCustomization,
    fetchBadgeLayouts,
    clearAutoPrintFeedback,
    showOfferCheckInMsg,
    showCanceledAttendeeFromSearch,
    buildAttendeeMessage,
    prefetchCheckInLists,
    getCheckInLists,
    reloadCheckInListsForCurrentEvent,
    refreshCheckInListsInBackground,
    invalidateCheckInListCache,
    $reset
  }
})

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
import { fetchBadgePdfWithRetry, printPdfBlob, PRINT_OUTCOME } from '@/utils/badgePdf'
import { getAutoPrintPreference, parseQrPayload } from '@/utils/session'

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProcessEventyayCheckInStore = defineStore('processEventyayCheckIn', () => {
  const cameraStore = useCameraStore()
  const message = ref(null)
  const showSuccess = ref(false)
  const showError = ref(false)
  const badgeUrl = ref('')
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

  async function fetchAndStoreCheckInLists(cacheKey) {
    const { processApi } = getEventListContext()
    const apitoken = processApi.apitoken
    const url = processApi.url
    const organizer = processApi.organizer
    const eventSlug = processApi.eventSlug
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
      // If no restriction, fall back to all lists (default: use first if multiple)
      const resolvedListIds = limitCheckInLists && limitCheckInLists.length > 0
        ? listIds
        : listIds.length > 0 ? [listIds[0]] : []

      checkInListCache.value = createCheckInListCache(cacheKey, resolvedListIds)

      return resolvedListIds
    })
  }

  async function getCheckInLists({ force = false } = {}) {
    const { processApi, cacheKey, isReady } = getEventListContext()

    if (!isReady) {
      return []
    }

    if (!force && isCheckInListCacheEntryValid(checkInListCache.value, cacheKey)) {
      return checkInListCache.value.listIds
    }

    try {
      return await fetchAndStoreCheckInLists(cacheKey)
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
    isGeneratingBadge.value = false
  }

  function isAutoPrintEnabled() {
    const { processApi } = getEventListContext()
    return processApi.selectedRole === 'Badge Station' && getAutoPrintPreference('Badge Station')
  }

  function clearAutoPrintFeedback() {
    if (autoPrintFeedbackTimer) {
      clearTimeout(autoPrintFeedbackTimer)
      autoPrintFeedbackTimer = null
    }
    autoPrintFeedback.value = null
  }

  function pushAutoPrintFeedback(status, text, durationMs = 2500) {
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
      $reset()
    }, durationMs)
  }

  async function runAutoPrintAfterCheckIn(badgeUrlPath, position, alreadyCheckedIn) {
    const attendeeLabel = position?.attendee_name || 'attendee'

    if (!badgeUrlPath) {
      pushAutoPrintFeedback('error', `No badge available for ${attendeeLabel}.`, 5000)
      return false
    }

    const customization = position?.badge_customization
    const shouldCustomize =
      autoPrintCustomizeOnce.value &&
      customization?.allow_customization &&
      customization.fields?.length

    if (shouldCustomize) {
      try {
        const customizationResult = await requestBadgeCustomization(customization)
        if (position?.id) {
          await saveBadgeCustomization(position.id, customizationResult)
        }
      } catch (error) {
        if (error?.message === 'cancelled') {
          clearAutoPrintFeedback()
          return false
        }
        throw error
      }
    }

    pushAutoPrintFeedback('printing', `Printing badge for ${attendeeLabel}…`, 0)

    const outcome = await printBadge(badgeUrlPath, { silent: true })

    if (outcome === PRINT_OUTCOME.PRINTED) {
      if (shouldCustomize) {
        autoPrintCustomizeOnce.value = false
      }
      pushAutoPrintFeedback(
        'success',
        alreadyCheckedIn
          ? `Reprinted: ${attendeeLabel} (already checked in)`
          : `Printed: ${attendeeLabel}`,
        2000
      )
    } else if (outcome === PRINT_OUTCOME.CANCELLED) {
      clearAutoPrintFeedback()
    } else {
      pushAutoPrintFeedback(
        'error',
        `Print failed for ${attendeeLabel}. Check printer or turn off auto-print to preview.`,
        4000
      )
    }

    return outcome === PRINT_OUTCOME.PRINTED
  }

  function showErrorMsg(msg) {
    if (isAutoPrintEnabled()) {
      pushAutoPrintFeedback('error', msg?.message || 'Check-in failed.', 4000)
      return
    }
    message.value = msg
    showSuccess.value = false
    showError.value = true
  }

  function showCheckoutRequiredMsg(msg) {
    if (isAutoPrintEnabled()) {
      pushAutoPrintFeedback('error', msg?.message || 'Check-out required.', 8000)
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
      attendee: position?.attendee_name || hints.attendee_name || 'Unknown Attendee',
      attendee_name: position?.attendee_name || hints.attendee_name || '',
      attendee_email: position?.attendee_email || hints.attendee_email || '',
      product_id: position?.product || null,
      variation: position?.variation || null,
      company: position?.company || hints.company || '',
      job_title: position?.job_title || hints.job_title || '',
      seat: position?.seat?.name || position?.seat || hints.seat || '',
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
      submessage: hints.submessage || '',
      badge_customization: position?.badge_customization || hints.badge_customization || null
    }
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

  function getRedeemErrorReason(response) {
    if (!response || typeof response !== 'object') {
      return null
    }

    const reason = String(response.reason || '').trim()
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
      'rules'
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

    return reason || null
  }

  function getRedeemErrorMessage(response) {
    if (!response || typeof response !== 'object') {
      return ''
    }

    const reason = getRedeemErrorReason(response)
    if (reason === 'checkout_required' && response.reason_explanation) {
      return String(response.reason_explanation)
    }
    if (reason === 'rules' && response.reason_explanation) {
      return String(response.reason_explanation)
    }

    const operatorMessages = {
      invalid: 'This ticket was not found for this event.',
      revoked: 'This ticket code has been revoked or changed.',
      ambiguous: 'Multiple tickets match this code. Try a more specific scan.',
      invalid_time: 'This ticket is not valid at this time.',
      already_redeemed: 'This ticket has already been redeemed.',
      checkout_required: 'Check-out is required before checking in again.',
      product: 'This ticket is not accepted at this check-in list/gate.',
      subevent: 'This ticket is for a different date or session. Use the correct check-in list/gate.',
      unpaid: 'This order has not been marked as paid.',
      rules: 'Check-in is blocked by custom rules for this ticket.'
    }

    if (reason && operatorMessages[reason]) {
      return operatorMessages[reason]
    }
    if (response.reason_explanation) {
      return String(response.reason_explanation)
    }
    if (response.detail) {
      return String(response.detail)
    }
    if (reason) {
      return reason
    }
    return ''
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
  }

  function handleRedeemErrorResponse(response, normalizedSecret, hints) {
    const reason = getRedeemErrorReason(response)
    const msg = buildAttendeeMessage(
      getRedeemErrorMessage(response) || 'Check-in failed!',
      response?.position,
      normalizedSecret,
      { ...hints, errorReason: reason }
    )
    if (reason === 'checkout_required' && response.cross_gate) {
      showCheckoutRequiredMsg({
        ...msg,
        crossGateCheckout: true,
      })
    } else if (reason === 'checkout_required') {
      setBadgeUrlFromPosition(response?.position)
      showCheckoutRequiredMsg(msg)
    } else if (reason === 'already_redeemed') {
      setBadgeUrlFromPosition(response?.position)
      showSuccessMsg({
        ...msg,
        alreadyCheckedIn: true,
        message: '',
      })
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

      // If the operator has selected a specific checkin list, use only that one
      const selectedListId = processApi.selectedCheckInListId
      const effectiveLists = selectedListId
        ? checkInLists.filter((id) => String(id) === String(selectedListId))
        : checkInLists
      const listsToUse = effectiveLists.length > 0 ? effectiveLists : checkInLists
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
          const printed = await runAutoPrintAfterCheckIn(
            badgeUrl.value,
            response.position,
            alreadyCheckedIn
          )
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

      const fallbackMessage = isRedeemNetworkError(error)
        ? 'Check-in failed. Check your connection and try again.'
        : getDeviceErrorMessage(error, 'This code is not valid for this event.', {
            hideHttpStatusText: true
          })
      showErrorMsg(buildAttendeeMessage(fallbackMessage, null, normalizedSecret, hints))
      return null
    }
  }

  async function getBadgeBlob(badgeUrlPath) {
    const { apitoken, url } = getEventListContext()

    if (!url || !apitoken || !badgeUrlPath) {
      return null
    }

    const result = await fetchBadgePdfWithRetry(badgeUrlPath, { baseUrl: url, apitoken })
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

  async function saveBadgeCustomization(positionId, result) {
    const { organizer, eventSlug, url, apitoken } = getEventListContext()
    if (!organizer || !eventSlug || !url || !apitoken || !positionId) {
      return
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
  }

  function requestBadgeCustomization(customization) {
    return new Promise((resolve, reject) => {
      badgeCustomizeRequest.value = { customization, resolve, reject }
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

  async function openBadgeCustomization(customization, positionId) {
    if (!customization?.allow_customization || !customization.fields?.length) {
      return null
    }

    try {
      const customizationResult = await requestBadgeCustomization(customization)
      if (positionId) {
        await saveBadgeCustomization(positionId, customizationResult)
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
    { silent = false, customize = true } = {}
  ) {
    const customization = position?.badge_customization
    if (customize && customization?.allow_customization && customization.fields?.length) {
      try {
        const customizationResult = await requestBadgeCustomization(customization)
        if (position?.id) {
          await saveBadgeCustomization(position.id, customizationResult)
        }
      } catch (error) {
        if (error?.message === 'cancelled') {
          return PRINT_OUTCOME.CANCELLED
        }
        throw error
      }
    }
    return printBadge(badgeUrlPath, { silent })
  }

  async function printBadge(badgeUrlPath, { silent = false } = {}) {
    if (!badgeUrlPath) {
      return PRINT_OUTCOME.FAILED
    }

    isGeneratingBadge.value = true

    try {
      const badgeResult = await getBadgeBlob(badgeUrlPath)
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

      return await printPdfBlob(badgeResult.blob, { silent })
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
    openBadgeCustomization,
    clearAutoPrintFeedback,
    showOfferCheckInMsg,
    buildAttendeeMessage,
    prefetchCheckInLists,
    getCheckInLists,
    reloadCheckInListsForCurrentEvent,
    refreshCheckInListsInBackground,
    invalidateCheckInListCache,
    $reset
  }
})

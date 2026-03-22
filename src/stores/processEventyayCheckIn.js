import { useCameraStore } from '@/stores/camera'
import { useEventyayApi } from '@/stores/eventyayapi'

import { mande } from 'mande'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProcessEventyayCheckInStore = defineStore('processEventyayCheckIn', () => {
  const cameraStore = useCameraStore()
  const message = ref('')
  const showSuccess = ref(false)
  const showError = ref(false)
  const badgeUrl = ref('')
  const isGeneratingBadge = ref(false)

  function $reset() {
    message.value = ''
    showSuccess.value = false
    showError.value = false
    badgeUrl.value = ''
    isGeneratingBadge.value = false
  }

  function showErrorMsg(msg) {
    message.value = msg
    showSuccess.value = false
    showError.value = true
  }

  function showSuccessMsg(msg) {
    message.value = msg
    showSuccess.value = true
    showError.value = false
  }

  function buildAttendeeMessage(messageText, position, secret = '') {
    return {
      message: messageText,
      attendee: position?.attendee_name || 'Unknown Attendee',
      attendee_name: position?.attendee_name || '',
      attendee_email: position?.attendee_email || '',
      product_id: position?.product || null,
      company: position?.company || '',
      job_title: position?.job_title || '',
      orderPositionId: position?.id || null,
      secret
    }
  }

  // Function to generate a random nonce
  function generateNonce(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  async function getCheckInLists() {
    const processApi = useEventyayApi()
    const { apitoken, url, organizer, eventSlug } = processApi
    const api = mande(url, { headers: { Authorization: `Device ${apitoken}` } })

    // Fetch the check-in lists
    const response = await api.get(
      `/api/v1/organizers/${organizer}/events/${eventSlug}/checkinlists/`
    )

    // Extract all IDs from the results
    const listIds = response.results.map((list) => list.id.toString())
    return listIds
  }

  async function getBadgeStatus(badgeUrl) {
    const processApi = useEventyayApi()
    const { apitoken, url } = processApi

    try {
      const api = mande(`${url}`, {
        headers: {
          Authorization: `Device ${apitoken}`,
        }
      })

	  const response = await api.get(badgeUrl)
      const blob = new Blob([response], { type: 'application/pdf' })

      if (blob.size > 0) {
        return response
      }

      return null
    } 
	catch (error) {
      const status = error?.response?.status || error?.status

      if (status === 406 || status === 409 || status === 202) {
        return null
      }

      throw error
    }
  }

  async function printBadge(badgeUrl) {
    if (!badgeUrl) {
      return false
    }

    isGeneratingBadge.value = true

    try {
      let badgeResponse = await getBadgeStatus(badgeUrl)
      let blob = new Blob([badgeResponse], { type: 'application/pdf' })
      if (blob.size == 0) {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          badgeResponse = await getBadgeStatus(badgeUrl)
          blob = new Blob([badgeResponse], { type: 'application/pdf' })
          if (blob.size > 0) break
        }
      }

      if (!badgeResponse) {
        return false
      }

      const blobUrl = URL.createObjectURL(blob)
      console.log('Opening badge for printing:', blobUrl)

      const printWindow = window.open(blobUrl, '_blank')
      if (printWindow) {
        printWindow.onload = function () {
          printWindow.print()
          URL.revokeObjectURL(blobUrl)
        }
      } else {
        URL.revokeObjectURL(blobUrl)
      }

      return true
    } catch (error) {
      console.error('Error printing badge:', error)
      showErrorMsg({
        message: 'Failed to print badge!',
        attendee: message.value?.attendee || 'Unknown Attendee'
      })
      return false
    } finally {
      isGeneratingBadge.value = false
    }
  }

  function extractTicketFromQrCode(rawValue, servername) {
    if (!rawValue) {
      return ''
    }

    if (servername === 'Open-Event') {
      return rawValue
    }

    const parsedValue = JSON.parse(rawValue)
    return parsedValue?.ticket || ''
  }

  async function checkInBySecret(secret) {
    const normalizedSecret = String(secret || '').trim()
    if (!normalizedSecret) {
      showErrorMsg(buildAttendeeMessage('Check-in failed!', null, normalizedSecret))
      return null
    }

    const processApi = useEventyayApi()
    const { apitoken, url, organizer } = processApi

    try {
      const checkInLists = await getCheckInLists()
      const nonce = generateNonce()

      const requestBody = {
        secret: normalizedSecret,
        source_type: 'barcode',
        lists: checkInLists,
        force: false,
        ignore_unpaid: false,
        nonce,
        datetime: null,
        questions_supported: false
      }

      const headers = {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/json'
      }

      const api = mande(url, { headers })
      const response = await api.post(`/api/v1/organizers/${organizer}/checkin/redeem/`, requestBody)
      console.log('Response:', response)

      if (response && (response.status === 'ok' || response.status === 'redeemed')) {
        const badgeDownload = response.position?.downloads?.find(
          (download) => download.output === 'badge'
        )

        badgeUrl.value = badgeDownload?.url || ''
        if (response.status === 'ok') {
          showSuccessMsg(
            buildAttendeeMessage('Check-in successful!', response.position, normalizedSecret)
          )
        } else {
          showSuccessMsg(
            buildAttendeeMessage('Already Checked-in!', response.position, normalizedSecret)
          )
        }
      } else {
        showErrorMsg(buildAttendeeMessage('Check-in failed!', response?.position, normalizedSecret))
      }

      return response
    } catch (error) {
      console.error('Fetch error:', error)
      showErrorMsg(buildAttendeeMessage('Check-in Failed!', null, normalizedSecret))
      return null
    }
  }

  async function checkIn(secretValue = null) {
    console.log('Check-in')
    const processApi = useEventyayApi()
    const { servername } = processApi

    try {
      const secret = secretValue || extractTicketFromQrCode(cameraStore.qrCodeValue, servername)
      return await checkInBySecret(secret)
    } catch (error) {
      console.error('Invalid payload or secret:', error)
      showErrorMsg(buildAttendeeMessage('Check-in Failed!', null))
      return null
    }
  }

  return {
    message,
    showSuccess,
    showError,
    badgeUrl,
    isGeneratingBadge,
    checkIn,
    checkInBySecret,
    printBadge,
    $reset
  }
})

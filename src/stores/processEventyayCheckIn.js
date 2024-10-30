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

  // Function to generate a random nonce
  function generateNonce(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  async function getlist() {
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

  // In processEventyayCheckIn.js
  async function getBadgeStatus(badgeUrl) {
    const processApi = useEventyayApi()
    const { apitoken, url } = processApi

    try {
      const api = mande(`${url}${badgeUrl}`, {
        headers: {
          Authorization: `Device ${apitoken}`,
          Accept: 'application/json'
        }
      })

      const response = await api.get()
      return response
    } catch (error) {
      if (error.response?.status === 409) {
        // Badge is still generating
        return null
      }
      throw error
    }
  }

  async function printBadge(badgeUrl) {
    isGeneratingBadge.value = true

    try {
      // First request to trigger generation
      console.log('Badge URL:', badgeUrl)
      let badgeResponse = await getBadgeStatus(badgeUrl)
      // If badge isn't ready, poll every second for up to 10 seconds
      if (!badgeResponse) {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          badgeResponse = await getBadgeStatus(badgeUrl)
          if (badgeResponse) break
        }
      }

      if (badgeResponse) {
        // Create a blob from the PDF data
        const blob = new Blob([badgeResponse], { type: 'application/pdf' })
        const blobUrl = URL.createObjectURL(blob)

        // Open print dialog
        const printWindow = window.open(blobUrl, '_blank')
        if (printWindow) {
          printWindow.onload = function () {
            printWindow.print()
            // Clean up the blob URL after printing
            URL.revokeObjectURL(blobUrl)
          }
        }
      }
    } catch (error) {
      console.error('Error printing badge:', error)
      showErrorMsg({
        message: 'Failed to print badge!',
        attendee: message.value?.attendee || 'Unknown Attendee'
      })
    } finally {
      isGeneratingBadge.value = false
    }
  }

  async function checkIn() {
    console.log('Check-in')
    const qrData = JSON.parse(cameraStore.qrCodeValue)
    const processApi = useEventyayApi()
    const { apitoken, url, organizer, eventSlug } = processApi

    const checkInList = await getlist()
    const nonce = generateNonce()

    const requestBody = {
      secret: qrData.ticket,
      source_type: 'barcode',
      lists: checkInList,
      force: false,
      ignore_unpaid: false,
      nonce: nonce,
      datetime: null,
      questions_supported: false
    }

    try {
      const headers = {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/json'
      }
      const api = mande(`${url}/api/v1/organizers/${organizer}/checkinrpc/redeem/`, {
        headers: headers
      })
      const response = await api.post(requestBody)
      console.log('Response:', response)

      if (response && (response.status === 'ok' || response.status === 'redeemed')) {
        const badgeDownload = response.position.downloads.find(
          (download) => download.output === 'badge'
        )

        if (badgeDownload) {
          badgeUrl.value = badgeDownload.url
        }

        showSuccessMsg({
          message: 'Check-in successful!',
          attendee: response.position.attendee_name
        })
      } else {
        showErrorMsg({
          message: 'Check-in failed!',
          attendee: response.position?.attendee_name || 'Unknown Attendee'
        })
      }
    } catch (error) {
      console.error('Fetch error:', error)
      showErrorMsg({
        message: 'Check-in Failed!',
        attendee: 'Unknown Attendee'
      })
    }
  }

  return {
    message,
    showSuccess,
    showError,
    badgeUrl,
    isGeneratingBadge,
    checkIn,
    printBadge,
    $reset
  }
})

import { useCameraStore } from '@/stores/camera'
import { useEventyayApi } from '@/stores/eventyayapi'
import { processCheckInResponse } from '@/utils/badgeHelpers'

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
  const isCheckoutMode = ref(false)

  const $reset = () => {
    message.value = ''
    showSuccess.value = false
    showError.value = false
    badgeUrl.value = ''
    isGeneratingBadge.value = false
  }

  const toggleMode = () => {
    isCheckoutMode.value = !isCheckoutMode.value
  }

  const showErrorMsg = (msg, attendeeName) => {
    message.value = {
      text: msg,
      attendee: attendeeName
    }
    showSuccess.value = false
    showError.value = true
  }

  const showSuccessMsg = (msg, attendeeName) => {
    message.value = {
      text: msg,
      attendee: attendeeName
    }
    showSuccess.value = true
    showError.value = false
  }

  const resetMessages = () => {
    showSuccess.value = false
    showError.value = false
    message.value = { text: '', attendee: '' }
  }

  // Function to generate a random nonce
  const generateNonce = (length = 32) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  const getlist = async () => {
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

  const getBadgeStatus = async (badgeUrl) => {
    const processApi = useEventyayApi()
    const { apitoken, url } = processApi

    try {
      const api = mande(`${url}${badgeUrl}`, {
        headers: {
          Authorization: `Device ${apitoken}`,
        }
      })

      const response = await api.get()
      return response
    } catch (error) {
      if (error.response?.status === 406) {
        return null
      }
      throw error
    }
  }

  const printBadge = async (badgeUrl) => {
    isGeneratingBadge.value = true

    try {
      let badgeResponse = await getBadgeStatus(badgeUrl)
      if (!badgeResponse) {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          badgeResponse = await getBadgeStatus(badgeUrl)
          if (badgeResponse) break
        }
      }

      if (badgeResponse) {
        const blob = new Blob([badgeResponse], { type: 'application/pdf' })
        const blobUrl = URL.createObjectURL(blob)

        const printWindow = window.open(blobUrl, '_blank')
        if (printWindow) {
          printWindow.onload = function() {
            printWindow.print()
            URL.revokeObjectURL(blobUrl)
          }
        }
      }
    } catch (error) {
      console.error('Error printing badge:', error)
      showErrorMsg('Failed to print badge!', message.value?.attendee || 'Unknown Attendee')
    } finally {
      isGeneratingBadge.value = false
    }
  }

  const checkIn = async () => {
    console.log('Check-in')
    const processApi = useEventyayApi()
    const { apitoken, url, organizer, servername, eventSlug } = processApi

	let qrData = {} 
    if (servername === 'Open-Event') {
      qrData = {
				ticket: cameraStore.qrCodeValue
			}
    } else {
      qrData = JSON.parse(cameraStore.qrCodeValue)
    }

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
      questions_supported: false,
      type: isCheckoutMode.value ? 'exit' : 'entry'
    }

    try {
      const headers = {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/json'
      }
      const api = mande(`${url}/api/v1/organizers/${organizer}/checkin/redeem/`, {
        headers: headers
      })
      const response = await api.post(requestBody)
      console.log('Response:', response)

      // Use shared helper to process response
      const result = processCheckInResponse(response, isCheckoutMode.value)
      
      if (result.badgeUrl) {
        badgeUrl.value = result.badgeUrl
      }
      
      if (result.success) {
        showSuccessMsg(result.message, result.attendeeName)
      } else {
        showErrorMsg(result.message, result.attendeeName)
      }
    } catch (error) {
      console.error('Fetch error:', error)
      const operation = isCheckoutMode.value ? 'Check-out' : 'Check-in'
      showErrorMsg(`${operation} Failed!`, 'Unknown Attendee')
    }
  }

  const eventCheckout = async () => {
    const processApi = useEventyayApi()
    const { apitoken, url, organizer, eventSlug } = processApi

    try {
      const headers = {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
      const api = mande(`${url}/api/v1/organizers/${organizer}/events/${eventSlug}/checkout/`, {
        headers: headers
      })
      const response = await api.post({})
      
      if (response && (response.status === 'success' || response.status === 'partial_success')) {
        showSuccessMsg(`Event checkout completed! ${response.checkout_count} attendees checked out.`, 'Event Checkout')
        if (response.errors && response.errors.length > 0) {
          console.warn('Some checkout errors occurred:', response.errors)
        }
      } else {
        showErrorMsg('Event checkout failed!', 'Event Checkout')
      }
    } catch (error) {
      console.error('Event checkout error:', error)
      showErrorMsg(`Event checkout failed! ${error.message || 'Unknown error'}`, 'Event Checkout')
    }
  }

  return {
    message,
    showSuccess,
    showError,
    badgeUrl,
    isGeneratingBadge,
    isCheckoutMode,
    checkIn,
    printBadge,
    toggleMode,
    resetMessages,
    eventCheckout,
    $reset
  }
})

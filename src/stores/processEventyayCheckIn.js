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
      
      // First, fetch all order positions to find checked-in attendees
      const ordersApi = mande(`${url}/api/v1/organizers/${organizer}/events/${eventSlug}/orderpositions/`, {
        headers: headers
      })
      
      let allOrders = []
      let nextUrl = '?include_checkins=true'
      
      // Fetch all pages of orders
      while (nextUrl) {
        const response = await ordersApi.get(nextUrl)
        allOrders = allOrders.concat(response.results)
        nextUrl = response.next ? response.next.replace(`${url}/api/v1/organizers/${organizer}/events/${eventSlug}/orderpositions/`, '') : null
      }
      
      // Filter for checked-in attendees (those with entry checkins)
      const checkedInOrders = allOrders.filter(order => {
        if (!order.checkins || order.checkins.length === 0) return false
        
        // Sort checkins by datetime to get the most recent
        const sortedCheckins = [...order.checkins].sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
        const mostRecentCheckin = sortedCheckins[0]
        
        // Return true if most recent checkin is entry type
        return mostRecentCheckin.type === 'entry'
      })
      
      if (checkedInOrders.length === 0) {
        showErrorMsg('No checked-in attendees found to checkout.', 'Event Checkout')
        return
      }
      
      // Checkout each attendee individually
      const redeemApi = mande(`${url}/api/v1/organizers/${organizer}/checkin/redeem/`, {
        headers: headers
      })
      
      let successCount = 0
      let errorCount = 0
      const errors = []
      
      // Get check-in lists (required for redeem API)
      const checkInList = await getlist()
      console.log('Check-in lists:', checkInList)
      
      for (const order of checkedInOrders) {
        try {
          console.log(`Attempting checkout for: ${order.attendee_name || 'Unknown'} (${order.secret})`)
          
          const requestBody = {
            secret: order.secret,
            source_type: 'barcode',
            lists: checkInList,
            force: false,
            ignore_unpaid: false,
            nonce: generateNonce(),
            datetime: null,
            questions_supported: false,
            type: 'exit'
          }
          
          console.log('Request body:', requestBody)
          const response = await redeemApi.post(requestBody)
          console.log('Checkout response:', response)
          successCount++
        } catch (error) {
          errorCount++
          console.error(`Error checking out ${order.attendee_name}:`, error)
          console.error('Error details:', {
            message: error.message,
            status: error.status,
            body: error.body,
            response: error.response
          })
          errors.push(`${order.attendee_name || 'Unknown'}: ${error.message || 'Unknown error'}`)
        }
      }
      
      // Show results
      if (successCount > 0) {
        const message = errorCount > 0 
          ? `Event checkout partially completed! ${successCount} attendees checked out, ${errorCount} failed.`
          : `Event checkout completed! ${successCount} attendees checked out.`
        showSuccessMsg(message, 'Event Checkout')
        
        if (errors.length > 0) {
          console.warn('Checkout errors:', errors)
        }
      } else {
        showErrorMsg(`Event checkout failed! All ${errorCount} checkout attempts failed.`, 'Event Checkout')
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

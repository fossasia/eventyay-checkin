<script setup>
import { ref, watch } from 'vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { mande } from 'mande'
import QRCamera from '@/components/Common/QRCamera.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import BadgePrintPreview from '@/components/Common/BadgePrintPreview.vue'
import { useLoadingStore } from '@/stores/loading'
import { useNotificationStore } from '@/stores/notification'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { useCheckInModal } from '@/composables/useCheckInModal'
import { storeToRefs } from 'pinia'

const notificationStore = useNotificationStore()
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const { message, showSuccess, showError, badgeUrl, isGeneratingBadge, isCheckoutMode } = storeToRefs(processEventyayCheckInStore)
const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug, eventname, selectedRole } = processApi

// Use check-in modal composable for modal countdown and state management
const {
  showModal,
  countdown,
  notes,
  startTimer,
  stopTimer,
  handleNotesInput,
  closeModal: handleCancel
} = useCheckInModal()

const loadingStore = useLoadingStore()
loadingStore.contentLoaded()
// Initialize Mande API instance
const api = mande(`${url}/api/v1/organizers/${organizer}/events/${eventSlug}`)
api.options.headers = {
  Authorization: `Device ${apitoken}`
}

const searchQuery = ref('')
const orders = ref([])
const loading = ref(false)

// Print preview related
const showPrintPreview = ref(false)
const baseUrl = `${url}/api/v1/organizers/${organizer}/events/${eventSlug}`
const fetchAllOrders = async (url, accumulatedOrders = []) => {
  console.log('Fetching orders from URL:', url)
  const response = await api.get(url)
  console.log('Fetched orders:', response)
  const newOrders = accumulatedOrders.concat(response.results)

  if (response.next) {
	console.log('Next URL:', response.next)
	const nextUrl = response.next.replace(`${baseUrl}`, '')  // Remove the current URL part to get the relative path
	console.log('Next URL after removal of base prefix:', nextUrl)
    return fetchAllOrders(nextUrl, newOrders)
  } else {
    return newOrders
  }
}

const searchOrders = async () => {
  if (!searchQuery.value) {
    orders.value = []
    return
  }

  loading.value = true
  notificationStore.addNotification(['Fetching orders...'], 'success')
  try {
    // Include checkins data in the API call
    const allOrders = await fetchAllOrders('orderpositions/?include_checkins=true')
    orders.value = allOrders.filter(
      (order) =>
        order.attendee_name?.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        order.attendee_email?.toLowerCase().includes(searchQuery.value.toLowerCase())
    )
    console.log('Filtered orders with checkins:', orders.value)
  } catch (error) {
    console.error('Error fetching orders:', error)
    orders.value = []
  } finally {
    loading.value = false
  }
}

const isCheckedIn = (order) => {
  console.log('Checking order:', order.attendee_name, 'checkins:', order.checkins)
  // Check if order has checkins and if the most recent one is an entry (not exit)
  if (!order.checkins || order.checkins.length === 0) {
    return false
  }
  
  // Sort checkins by datetime to get the most recent
  const sortedCheckins = [...order.checkins].sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
  const mostRecentCheckin = sortedCheckins[0]
  
  // Return true if most recent checkin is entry type, false if exit type
  return mostRecentCheckin.type === 'entry'
}

// Helper function to generate nonce
const generateNonce = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

const checkIn = async (order) => {
  try {
    if (isCheckoutMode.value) {
      // Checkout mode - use the redeem endpoint with exit type
      const requestBody = {
        secret: order.secret,
        source_type: 'barcode',
        lists: await getCheckInLists(),
        force: false,
        ignore_unpaid: false,
        nonce: generateNonce(),
        datetime: null,
        questions_supported: false,
        type: 'exit'
      }
      
      const headers = {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/json'
      }
      const redeemApi = mande(`${url}/api/v1/organizers/${organizer}/checkin/redeem/`, {
        headers: headers
      })
      await redeemApi.post(requestBody)
      notificationStore.addNotification([`${order.attendee_name} checked out successfully!`], 'success')
    } else {
      // Check-in mode - use the redeem endpoint with entry type
      const requestBody = {
        secret: order.secret,
        source_type: 'barcode',
        lists: await getCheckInLists(),
        force: false,
        ignore_unpaid: false,
        nonce: generateNonce(),
        datetime: null,
        questions_supported: false,
        type: 'entry'
      }
      
      const headers = {
        Authorization: `Device ${apitoken}`,
        Accept: 'application/json'
      }
      const redeemApi = mande(`${url}/api/v1/organizers/${organizer}/checkin/redeem/`, {
        headers: headers
      })
      await redeemApi.post(requestBody)
      notificationStore.addNotification([`${order.attendee_name} checked in successfully!`], 'success')
    }
    
    // Refresh the orders to show updated checkin status
    await searchOrders()
  } catch (error) {
    console.error('Error during check-in/checkout:', error)
    const operation = isCheckoutMode.value ? 'checkout' : 'check-in'
    const errorMessage = error.response?.data?.detail || error.message || 'Unknown error'
    notificationStore.addNotification([`Error during ${operation}: ${errorMessage}`], 'error')
  }
}

// Helper function to get check-in lists
const getCheckInLists = async () => {
  try {
    const response = await api.get('checkinlists/')
    return response.results.map((list) => list.id.toString())
  } catch (error) {
    console.error('Error fetching check-in lists:', error)
    return []
  }
}

const handleToggleMode = () => {
  processEventyayCheckInStore.toggleMode()
}

function handleEventCheckout() {
  if (confirm('Are you sure you want to check out all attendees from this event?')) {
    processEventyayCheckInStore.eventCheckout()
  }
}

// Modal and print related functions

function handlePrintBadge() {
  console.log('Printing badge...')
  if (badgeUrl.value) {
    showPrintPreview.value = true
  }
}

function handlePrintClose() {
  showPrintPreview.value = false
  startTimer()
}

async function handlePrint() {
  stopTimer()
  if (badgeUrl.value) {
    await processEventyayCheckInStore.printBadge(badgeUrl.value)
  }
  handlePrintBadge()
}

function showPopup() {
  showModal.value = true
  startTimer()
  if (selectedRole === "Badge Station") { handlePrint() }
}

const generateBadge = async (order) => {
  try {
    loading.value = true
    console.log('Generating badge for order:', order)
    
    // First, check if the order has a badge URL in downloads
    if (order.downloads && order.downloads.length > 0) {
      const badgeDownload = order.downloads.find(dl => dl.type === 'pdf' || dl.name?.toLowerCase().includes('badge'))
      if (badgeDownload?.url) {
        // Set the badge URL in the store and show print preview
        processEventyayCheckInStore.setBadgeUrl(badgeDownload.url)
        showPrintPreview.value = true
        notificationStore.addNotification([`Badge ready for ${order.attendee_name}`], 'success')
        return
      }
    }
    
    // If no direct download URL, try to generate the badge
    const headers = {
      Authorization: `Device ${apitoken}`,
      Accept: 'application/json'
    }
    
    // Use the order positions endpoint to generate badge
    const badgeApi = mande(`${url}/api/v1/organizers/${organizer}/events/${eventSlug}/orderpositions/${order.id}/badge/`, {
      headers: headers
    })
    
    const response = await badgeApi.get()
    console.log('Badge generation response:', response)
    
    if (response?.download_url) {
      // Set the badge URL in the store and show print preview
      processEventyayCheckInStore.setBadgeUrl(response.download_url)
      showPrintPreview.value = true
      notificationStore.addNotification([`Badge generated for ${order.attendee_name}!`], 'success')
    } else {
      notificationStore.addNotification(['No badge template available for this ticket'], 'error')
    }
  } catch (error) {
    console.error('Error generating badge:', error)
    const errorMessage = error.response?.data?.detail || error.message || 'Unknown error'
    notificationStore.addNotification([`Badge generation failed: ${errorMessage}`], 'error')
  } finally {
    loading.value = false
  }
}

// Watch for popup triggers
watch([showSuccess, showError], ([newSuccess, newError], [oldSuccess, oldError]) => {
  if ((!oldSuccess && newSuccess) || (!oldError && newError)) {
    showPopup()
  }
})
</script>
<template>
  <div class="flex flex-col lg:flex-row h-screen w-full">
    <!-- Left side: Event info, controls, and QR camera -->
    <div class="w-full lg:w-1/2 flex flex-col">
      <!-- Event title and controls at top left -->
      <div class="p-4 lg:p-6">
        <h1 class="text-2xl lg:text-3xl font-bold mb-2">{{ eventname }}</h1>
        <p name="date" class="text-gray-600 text-base lg:text-lg font-semibold mb-4 lg:mb-6">{{ new Date().toDateString() }}</p>
        
        <!-- Mode Toggle and Event Checkout Controls -->
        <div class="flex flex-col items-center lg:items-start space-y-3 lg:space-y-4">
          <!-- Check-in/Check-out Toggle -->
          <div class="flex items-center justify-center lg:justify-start space-x-3">
  <span class="text-xs lg:text-sm font-medium" :class="!isCheckoutMode ? 'text-green-600 font-semibold' : 'text-gray-500'">Check-in</span>

  <label class="relative inline-flex items-center cursor-pointer select-none">
    <input type="checkbox" :checked="isCheckoutMode" @change="handleToggleMode" class="sr-only peer focus:outline-none focus:ring-0" />

    <div
      class="w-16 h-8 rounded-full relative transition-colors duration-300 ease-in-out border-2 border-gray-300 shadow-sm"
      :class="isCheckoutMode ? 'bg-red-500 border-red-400' : 'bg-green-500 border-green-400'"
    >
      <div
        class="absolute bottom-1 top-1 left-1 h-5 w-5 bg-white rounded-full shadow-lg
               transition-transform duration-300 ease-in-out border border-gray-200"
        :class="isCheckoutMode ? 'translate-x-8' : 'translate-x-0'"
      ></div>
    </div>
  </label>

  <span class="text-xs lg:text-sm font-medium" :class="isCheckoutMode ? 'text-red-600 font-semibold' : 'text-gray-500'">Check-out</span>
</div>


          
          <!-- Event Checkout Button -->
          <StandardButton
            v-if="isCheckoutMode"
            type="button"
            text="Checkout All Attendees"
            @click="handleEventCheckout"
            class="btn-danger px-4 lg:px-6 py-2 text-xs lg:text-sm mx-auto lg:mx-0"
          />
        </div>
      </div>
      
      <!-- QR Camera centered in remaining space -->
      <div class="flex-1 flex items-center justify-center p-4 lg:p-0 min-h-[200px] lg:min-h-0">
        <div class="w-full max-w-sm lg:max-w-none">
          <QRCamera qr-type="eventyaycheckin" :scan-type="isCheckoutMode ? 'Check-Out' : 'Check-In'" />
        </div>
      </div>
    </div>

    <!-- Right side: Search functionality -->
    <div class="w-full lg:w-1/2 p-4 lg:p-4 flex-1 lg:flex-none overflow-y-auto">
      <div class="mb-4">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search orders by name or email..."
          class="w-full rounded border p-3 lg:p-2 text-base lg:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          @input="searchOrders"
        />
      </div>

      <div v-if="!searchQuery" class="text-gray-500 mt-6 lg:mt-8 text-center">
        <p class="text-lg lg:text-xl">Search Orders by Name or Email</p>
      </div>

      <div v-else>
        <div v-if="loading" class="text-center py-4">Loading...</div>
        <div v-else-if="orders.length === 0" class="text-gray-500 text-center py-4">No orders found</div>
        <div v-else class="space-y-3 lg:space-y-4">
          <div v-for="order in orders" :key="order.id" class="rounded border p-3 lg:p-4 bg-white shadow-sm">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-3 lg:space-y-0">
              <div class="flex-1">
                <h3 class="font-bold text-base lg:text-lg">{{ order.attendee_name }}</h3>
                <p class="text-gray-600 text-sm lg:text-base">{{ order.attendee_email || 'No email provided' }}</p>
                <p class="text-gray-500 text-xs lg:text-sm">Secret: {{ order.secret }}</p>
              </div>
              <div class="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2 lg:space-x-2">
                <button
                  @click="checkIn(order)"
                  :class="{
                    'rounded px-3 py-2 lg:px-4 lg:py-2 text-white transition-colors font-medium text-sm lg:text-base w-full sm:w-auto': true,
                    'bg-green-600 hover:bg-green-700': !isCheckedIn(order),
                    'bg-gray-400 cursor-not-allowed': isCheckedIn(order),
                    'bg-red-600 hover:bg-red-700': isCheckoutMode && isCheckedIn(order)
                  }"
                  :style="{
                    backgroundColor: isCheckoutMode && isCheckedIn(order) ? '#dc2626' : 
                                   isCheckedIn(order) ? '#9ca3af' : '#059669',
                    color: 'white',
                    border: 'none'
                  }"
                  :disabled="isCheckedIn(order) && !isCheckoutMode"
                >
                  {{ 
                    isCheckoutMode 
                      ? (isCheckedIn(order) ? 'Check Out' : 'Not Checked In')
                      : (isCheckedIn(order) ? 'Checked In' : 'Check In')
                  }}
                </button>
                <button
                  @click="generateBadge(order)"
                  class="rounded bg-primary px-3 py-2 lg:px-4 lg:py-2 text-white hover:bg-primary-dark font-medium text-sm lg:text-base w-full sm:w-auto"
                >
                  Generate Badge
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Attendee Info Popup Modal -->
    <div
      v-if="showModal && (showSuccess || showError) && message?.attendee"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
    >
      <div class="relative w-full max-w-sm lg:max-w-md rounded bg-white p-4 lg:p-5 shadow-lg mx-4">
        <!-- Countdown display -->
        <div
          class="bg-gray-200 text-gray-600 absolute right-2 top-2 flex h-6 w-6 lg:h-8 lg:w-8 items-center justify-center rounded-full font-medium text-xs lg:text-sm"
        >
          {{ countdown }}
        </div>

        <h2 :class="showError ? 'text-red-600 mb-2 text-lg lg:text-xl' : 'text-green-600 mb-2 text-lg lg:text-xl'">
          {{ message.text }}
        </h2>
        <div>
          <p><b>Name:</b> {{ message.attendee }}</p>
          <div class="mt-4 flex flex-col space-y-3" @click="handleNotesInput">
            <StandardButton
              v-if="badgeUrl && showSuccess"
              type="button"
              :text="isGeneratingBadge ? 'Generating Badge...' : 'Generate Badge'"
              :disabled="isGeneratingBadge"
              @click="handlePrint"
              class="btn-primary w-full justify-center"
            />
            <StandardButton
              type="submit"
              text="Done"
              @click="handleCancel"
              class="btn-info mt-6 w-1/4 justify-center"
            />
          </div>
        </div>
      </div>
    </div>
    
    <BadgePrintPreview
      v-if="showPrintPreview"
      :url="`${url}${badgeUrl}`"
      @close="handlePrintClose"
    />
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { mande } from 'mande'
import QRCamera from '@/components/Common/QRCamera.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import BadgePrintPreview from '@/components/Common/BadgePrintPreview.vue'
import { useLoadingStore } from '@/stores/loading'
import { useNotificationStore } from '@/stores/notification'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { storeToRefs } from 'pinia'

const notificationStore = useNotificationStore()
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const { message, showSuccess, showError, badgeUrl, isGeneratingBadge, isCheckoutMode } = storeToRefs(processEventyayCheckInStore)
const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug, eventname, selectedRole } = processApi

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

// Popup related variables
const showPrintPreview = ref(false)
const countdown = ref(5)
const timerInstance = ref(null)
const timeoutInstance = ref(null)
const notes = ref('')
const baseUrl = `${url}/api/v1/organizers/${organizer}/events/${eventSlug}`
const fetchAllOrders = async (url, accumulatedOrders = []) => {
  console.log('Fetching orders from URL:', url)
  const response = await api.get(url)
  console.log('Fetched orders:', response)
  const newOrders = accumulateds.concat(response.results)

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
    const allOrders = await fetchAllOrders('orderpositions/')
    orders.value = allOrders.filter(
      (order) =>
        order.attendee_name?.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        order.attendee_email?.toLowerCase().includes(searchQuery.value.toLowerCase())
    )
  } catch (error) {
    console.error('Error fetching orders:', error)
    orders.value = []
  } finally {
    loading.value = false
  }
}

const isCheckedIn = (order) => {
  return order.checkins && order.checkins.length > 0
}

const checkIn = async (order) => {
  try {
    if (isCheckoutMode.value) {
      // Checkout mode - use the proper redeem endpoint with exit type
      const requestBody = {
        secret: order.secret,
        lists: await getCheckInLists(),
        type: 'exit',
        datetime: null,
        questions_supported: false
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
      // Check-in mode
      await api.post(`orderpositions/${order.id}/checkin/`, {})
      notificationStore.addNotification([`${order.attendee_name} checked in successfully!`], 'success')
    }
    // Refresh the orders to show updated checkin status
    searchOrders()
  } catch (error) {
    console.error('Error during check-in/checkout:', error)
    const operation = isCheckoutMode.value ? 'checkout' : 'check-in'
    notificationStore.addNotification([`Error during ${operation}: ${error.message || 'Unknown error'}`], 'error')
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

// Popup related functions
function startCountdown() {
  countdown.value = 10
  timerInstance.value = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(timerInstance.value)
      processEventyayCheckInStore.$reset()
    }
  }, 1000)
}

function stopTimer() {
  if (timerInstance.value) {
    clearInterval(timerInstance.value)
  }
  if (timeoutInstance.value) {
    clearTimeout(timeoutInstance.value)
  }
}

function handleNotesInput() {
  stopTimer()
  countdown.value = '...'
}

function handleCancel() {
  processEventyayCheckInStore.$reset()
  stopTimer()
}

function handlePrintBadge() {
  console.log('Printing badge...')
  if (badgeUrl.value) {
    showPrintPreview.value = true
  }
}

function handlePrintClose() {
  showPrintPreview.value = false
  startCountdown()
}

async function handlePrint() {
  stopTimer()
  if (badgeUrl.value) {
    await processEventyayCheckInStore.printBadge(badgeUrl.value)
  }
  handlePrintBadge()
}

function showPopup() {
  notes.value = ''
  startCountdown()
  if (selectedRole === "Badge Station") { handlePrint() }
  timeoutInstance.value = setTimeout(() => {
    processEventyayCheckInStore.$reset()
  }, 10000)
}

const generateBadge = (order) => {
  // Assuming the first download URL is the badge PDF
  if (order.downloads && order.downloads.length > 0) {
    window.open(order.downloads[0].url, '_blank')
  }
}

// Watch for popup triggers
watch([showSuccess, showError], ([newSuccess, newError], [oldSuccess, oldError]) => {
  if ((!oldSuccess && newSuccess) || (!oldError && newError)) {
    showPopup()
  }
})

// Cleanup timers when component is destroyed
onUnmounted(() => {
  stopTimer()
})
</script>
<template>
  <div class="flex h-screen w-full">
    <!-- Left side: Event info, controls, and QR camera -->
    <div class="w-1/2 flex flex-col">
      <!-- Event title and controls at top left -->
      <div class="p-6">
        <h1 class="text-3xl font-bold mb-2">{{ eventname }}</h1>
        <p name="date" class="text-gray-600 text-lg font-semibold mb-6">{{ new Date().toDateString() }}</p>
        
        <!-- Mode Toggle and Event Checkout Controls -->
        <div class="flex flex-col space-y-4">
          <!-- Check-in/Check-out Toggle -->
          <div class="flex items-center space-x-3">
            <span class="text-sm font-medium" :class="!isCheckoutMode ? 'text-green-600' : 'text-gray-500'">Check-in</span>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" :checked="isCheckoutMode" @change="handleToggleMode" class="sr-only peer">
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
            <span class="text-sm font-medium" :class="isCheckoutMode ? 'text-red-600' : 'text-gray-500'">Check-out</span>
          </div>
          
          <!-- Event Checkout Button -->
          <StandardButton
            v-if="isCheckoutMode"
            type="button"
            text="Checkout All Attendees"
            @click="handleEventCheckout"
            class="btn-danger px-6 py-2 text-sm w-fit"
          />
        </div>
      </div>
      
      <!-- QR Camera centered in remaining space -->
      <div class="flex-1 flex items-center justify-center">
        <QRCamera qr-type="eventyaycheckin" :scan-type="isCheckoutMode ? 'Check-Out' : 'Check-In'" />
      </div>
    </div>

    <!-- Right side: Search functionality -->
    <div class="w-1/2 p-4">
      <div class="mb-4">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search orders by name or email..."
          class="w-full rounded border p-2"
          @input="searchOrders"
        />
      </div>

      <div v-if="!searchQuery" class="text-gray-500 mt-8 text-center">
        <p class="text-xl">Search Orders by Name or Email</p>
      </div>

      <div v-else>
        <div v-if="loading" class="text-center">Loading...</div>
        <div v-else-if="orders.length === 0" class="text-gray-500 text-center">No orders found</div>
        <div v-else class="space-y-4">
          <div v-for="order in orders" :key="order.id" class="rounded border p-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-bold">{{ order.attendee_name }}</h3>
                <p class="text-gray-600">{{ order.attendee_email || 'No email provided' }}</p>
                <p class="text-gray-500 text-sm">Secret: {{ order.secret }}</p>
              </div>
              <div class="space-x-2">
                <button
                  @click="checkIn(order)"
                  :class="{
                    'rounded px-4 py-2 text-white': true,
                    'bg-red-600 hover:bg-red-700': isCheckoutMode && isCheckedIn(order),
                    'bg-gray-400 cursor-not-allowed': isCheckoutMode && !isCheckedIn(order),
                    'bg-green-600 hover:bg-green-700': !isCheckoutMode && !isCheckedIn(order),
                    'bg-gray-400 cursor-not-allowed': !isCheckoutMode && isCheckedIn(order)
                  }"
                  :disabled="(isCheckoutMode && !isCheckedIn(order)) || (!isCheckoutMode && isCheckedIn(order))"
                >
                  {{ 
                    isCheckoutMode 
                      ? (isCheckedIn(order) ? 'Check Out' : 'Not Checked In')
                      : (isCheckedIn(order) ? 'Checked In' : 'Check In')
                  }}
                </button>
                <button
                  @click="generateBadge(order)"
                  class="rounded bg-primary px-4 py-2 text-white hover:bg-primary-dark"
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
      v-if="(showSuccess || showError) && message?.attendee"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    >
      <div class="relative w-96 rounded bg-white p-5 shadow-lg">
        <!-- Countdown display -->
        <div
          class="bg-gray-200 text-gray-600 absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full font-medium"
        >
          {{ countdown }}
        </div>

        <h2 :class="showError ? 'text-red-600 mb-2 text-xl' : 'text-green-600 mb-2 text-xl'">
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

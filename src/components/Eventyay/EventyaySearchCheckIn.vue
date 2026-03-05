<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
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
const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug } = processApi
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const { message, showSuccess, showError, badgeUrl } = storeToRefs(processEventyayCheckInStore)

const loadingStore = useLoadingStore()
loadingStore.contentLoaded()
// Initialize Mande API instance
const api = mande(url)
api.options.headers = {
  Authorization: `Device ${apitoken}`
}

const searchQuery = ref('')
const orders = ref([])
const loading = ref(false)
const showPrintPreview = ref(false)
const countdown = ref(10)
const searchCache = new Map()
const SEARCH_DEBOUNCE_MS = 300
const MIN_SEARCH_LENGTH = 2
const SEARCH_RESULTS_LIMIT = 50
let debounceTimer = null
let activeRequestId = 0
let popupTimer = null
let popupTimeout = null

const joinUrl = (base, path) => `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`

const startPopupCountdown = () => {
  clearPopupTimers()
  countdown.value = 10
  popupTimer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      processEventyayCheckInStore.$reset()
      clearPopupTimers()
    }
  }, 1000)
}

const clearPopupTimers = () => {
  if (popupTimer) {
    clearInterval(popupTimer)
    popupTimer = null
  }
  if (popupTimeout) {
    clearTimeout(popupTimeout)
    popupTimeout = null
  }
}

const showPopup = () => {
  startPopupCountdown()
  popupTimeout = setTimeout(() => {
    processEventyayCheckInStore.$reset()
    clearPopupTimers()
  }, 10000)
}

const closePopup = () => {
  processEventyayCheckInStore.$reset()
  clearPopupTimers()
}

const openBadgePreview = () => {
  if (!badgeUrl.value) {
    return
  }
  clearPopupTimers()
  showPrintPreview.value = true
}

const handlePrintClose = () => {
  showPrintPreview.value = false
  startPopupCountdown()
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
    page_size: String(SEARCH_RESULTS_LIMIT)
  })
  return `api/v1/organizers/${organizer}/events/${eventSlug}/orderpositions/?${params.toString()}`
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
    const response = await api.get(buildSearchPath(normalizedQuery))
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
    notificationStore.addNotification(['Error', 'Unable to fetch orders'], 'error')
    orders.value = []
  } finally {
    if (requestId === activeRequestId) {
      loading.value = false
    }
  }
}

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

watch([showSuccess, showError], ([newSuccess, newError], [oldSuccess, oldError]) => {
  if ((!oldSuccess && newSuccess) || (!oldError && newError)) {
    showPopup()
  }
})

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  clearPopupTimers()
})

const isCheckedIn = (order) => {
  return order.checkins && order.checkins.length > 0
}

const checkIn = async (order) => {
  const response = await processEventyayCheckInStore.checkInBySecret(order.secret)
  if (!response || (response.status !== 'ok' && response.status !== 'redeemed')) {
    notificationStore.addNotification(['Error', 'Unable to check in attendee'], 'error')
    return
  }

  order.checkins = response.position?.checkins || [...(order.checkins || []), { datetime: new Date().toISOString() }]
  if (response.position?.downloads) {
    order.downloads = response.position.downloads
  }
}

</script>
<template>
  <div class="flex h-screen justify-center">
    <div class="flex w-1/2 items-center">
      <QRCamera qr-type="eventyaycheckin" scan-type="Check-In" />
    </div>

    <div class="w-1/2 justify-center p-4">
      <div class="mb-4">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search orders by name or email..."
          class="w-full rounded border p-2"
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
                  class="rounded bg-success px-4 py-2 text-white hover:bg-primary"
                  :disabled="isCheckedIn(order)"
                  @click="checkIn(order)"
                >
                  {{ isCheckedIn(order) ? 'Checked In' : 'Check In' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="(showSuccess || showError) && message?.attendee"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    >
      <div class="relative w-96 rounded bg-white p-5 shadow-lg">
        <div
          class="bg-gray-200 text-gray-600 absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full font-medium"
        >
          {{ countdown }}
        </div>
        <h2 :class="showError ? 'text-red-600 mb-2 text-xl' : 'text-green-600 mb-2 text-xl'">
          {{ message.message }}
        </h2>
        <div>
          <p><b>Name:</b> {{ message.attendee }}</p>
          <div class="mt-4 flex flex-col space-y-3">
            <StandardButton
              v-if="badgeUrl && showSuccess"
              type="button"
              text="Generate Badge"
              class="btn-primary w-full justify-center"
              @click="openBadgePreview"
            />
            <StandardButton
              type="button"
              text="Done"
              class="btn-info mt-6 w-1/4 justify-center"
              @click="closePopup"
            />
          </div>
        </div>
      </div>
    </div>

    <BadgePrintPreview
      v-if="showPrintPreview && badgeUrl"
      :url="joinUrl(url, badgeUrl)"
      @close="handlePrintClose"
    />
  </div>
</template>

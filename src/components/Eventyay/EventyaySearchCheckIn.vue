<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { mande } from 'mande'
import QRCamera from '@/components/Common/QRCamera.vue'
import { useLoadingStore } from '@/stores/loading'
import { useNotificationStore } from '@/stores/notification'

const notificationStore = useNotificationStore()
const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug } = processApi

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
const searchCache = new Map()
const SEARCH_DEBOUNCE_MS = 300
const MIN_SEARCH_LENGTH = 2
const SEARCH_RESULTS_LIMIT = 50
let debounceTimer = null
let activeRequestId = 0

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

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
})

const isCheckedIn = (order) => {
  return order.checkins && order.checkins.length > 0
}

const checkIn = async (order) => {
  try {
    await api.post(`api/v1/organizers/${organizer}/events/${eventSlug}/orderpositions/${order.id}/checkin/`, {})
    order.checkins = [...(order.checkins || []), { datetime: new Date().toISOString() }]
  } catch (error) {
    console.error('Error checking in:', error)
    notificationStore.addNotification(['Error', 'Unable to check in attendee'], 'error')
  }
}

const generateBadge = (order) => {
  // Assuming the first download URL is the badge PDF
  if (order.downloads && order.downloads.length > 0) {
    window.open(order.downloads[0].url, '_blank')
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
                <button
                  class="rounded bg-primary px-4 py-2 text-white hover:bg-primary-dark"
                  @click="generateBadge(order)"
                >
                  Generate Badge
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { mande } from 'mande'
import QRCamera from '@/components/Common/QRCamera.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import BadgePrintPreview from '@/components/Common/BadgePrintPreview.vue'
import { useLoadingStore } from '@/stores/loading'
import { useNotificationStore } from '@/stores/notification'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { useLiveRegistrationStore } from '@/stores/liveRegistration'
import { storeToRefs } from 'pinia'
import { PencilSquareIcon } from '@heroicons/vue/20/solid'

const notificationStore = useNotificationStore()
const processApi = useEventyayApi()
const { apitoken, url, organizer, eventSlug } = processApi
const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const { message, showSuccess, showError, badgeUrl } = storeToRefs(processEventyayCheckInStore)
const liveRegistrationStore = useLiveRegistrationStore()
const { products, isLoadingProducts, isRegistering } = storeToRefs(liveRegistrationStore)

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
const isEditDialogOpen = ref(false)
const isSavingAttendee = ref(false)
const editError = ref('')
const editableAttendee = ref({
  attendee_name: '',
  attendee_email: '',
  company: '',
  job_title: ''
})
const originalAttendee = ref({
  attendee_name: '',
  attendee_email: '',
  company: '',
  job_title: ''
})
const isLiveRegistrationDialogOpen = ref(false)
const liveRegistrationError = ref('')
const liveRegistrationForm = ref({
  attendee_name: '',
  attendee_email: '',
  company: '',
  job_title: '',
  product_id: ''
})
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
  isEditDialogOpen.value = false
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

const getProductEnglishName = (product) => {
  if (!product?.name) {
    return `Product ${product?.id || ''}`.trim()
  }

  if (typeof product.name === 'string') {
    return product.name
  }

  if (typeof product.name === 'object') {
    return product.name.en || Object.values(product.name)[0] || `Product ${product.id}`
  }

  return `Product ${product.id}`
}

const getProductDisplayLabel = (product) =>
  `${getProductEnglishName(product)} (${product.default_price || '0.00'})`

const resetLiveRegistrationForm = () => {
  liveRegistrationForm.value = {
    attendee_name: '',
    attendee_email: '',
    company: '',
    job_title: '',
    product_id: products.value.length ? String(products.value[0].id) : ''
  }
}

const openLiveRegistrationDialog = async () => {
  liveRegistrationError.value = ''

  if (!products.value.length) {
    try {
      await liveRegistrationStore.fetchProducts({ force: true })
    } catch (error) {
      console.error('Error fetching products for live registration:', error)
      liveRegistrationError.value = 'Unable to load products for registration.'
    }
  }

  resetLiveRegistrationForm()
  isLiveRegistrationDialogOpen.value = true
}

const closeLiveRegistrationDialog = () => {
  isLiveRegistrationDialogOpen.value = false
  liveRegistrationError.value = ''
}

const submitLiveRegistration = async () => {
  if (isRegistering.value) {
    return
  }

  const attendeeName = String(liveRegistrationForm.value.attendee_name || '').trim()
  const attendeeEmail = String(liveRegistrationForm.value.attendee_email || '').trim()
  const selectedProductId = String(liveRegistrationForm.value.product_id || '').trim()

  if (!attendeeName || !attendeeEmail || !selectedProductId) {
    liveRegistrationError.value = 'Attendee name, attendee email, and product are required.'
    return
  }

  liveRegistrationError.value = ''

  try {
    const registrationResult = await liveRegistrationStore.registerAndMarkPaid(
      {
        attendee_name: attendeeName,
        attendee_email: attendeeEmail,
        company: String(liveRegistrationForm.value.company || '').trim(),
        job_title: String(liveRegistrationForm.value.job_title || '').trim()
      },
      Number(selectedProductId)
    )

    const checkInResponse = await processEventyayCheckInStore.checkInBySecret(registrationResult.secret)
    if (!checkInResponse || (checkInResponse.status !== 'ok' && checkInResponse.status !== 'redeemed')) {
      throw new Error('Registration completed but automatic check-in failed.')
    }

    closeLiveRegistrationDialog()
    notificationStore.addNotification(['Success', 'Attendee registered and marked paid'], 'success')
  } catch (error) {
    console.error('Live registration failed:', error)
    liveRegistrationError.value = error?.body?.detail || error?.message || 'Live registration failed.'
  }
}

const formatAttendeeForEdit = (attendeeMessage = {}) => ({
  attendee_name: attendeeMessage.attendee_name || attendeeMessage.attendee || '',
  attendee_email: attendeeMessage.attendee_email || '',
  company: attendeeMessage.company || '',
  job_title: attendeeMessage.job_title || ''
})

const openEditDialog = () => {
  editableAttendee.value = formatAttendeeForEdit(message.value)
  originalAttendee.value = { ...editableAttendee.value }
  editError.value = ''
  isEditDialogOpen.value = true
  clearPopupTimers()
  countdown.value = '...'
}

const closeEditDialog = () => {
  isEditDialogOpen.value = false
  editError.value = ''
  if (showSuccess.value || showError.value) {
    startPopupCountdown()
  }
}

const getModifiedAttendeeFields = () => {
  const payload = {}
  const trackedFields = ['attendee_name', 'attendee_email', 'company', 'job_title']

  trackedFields.forEach((field) => {
    if (editableAttendee.value[field] !== originalAttendee.value[field]) {
      payload[field] = editableAttendee.value[field]
    }
  })

  return payload
}

const updateOrderInSearchResults = (updatedOrderPosition) => {
  if (!updatedOrderPosition?.id) {
    return
  }

  const matchedOrder = orders.value.find((order) => String(order.id) === String(updatedOrderPosition.id))
  if (!matchedOrder) {
    return
  }

  matchedOrder.attendee_name = updatedOrderPosition.attendee_name || matchedOrder.attendee_name
  matchedOrder.attendee_email = updatedOrderPosition.attendee_email || matchedOrder.attendee_email
  matchedOrder.company = updatedOrderPosition.company || ''
  matchedOrder.job_title = updatedOrderPosition.job_title || ''
}

const updatePopupAttendee = (updatedOrderPosition) => {
  if (!updatedOrderPosition) {
    return
  }

  message.value = {
    ...message.value,
    attendee: updatedOrderPosition.attendee_name || message.value?.attendee || '',
    attendee_name: updatedOrderPosition.attendee_name || '',
    attendee_email: updatedOrderPosition.attendee_email || '',
    company: updatedOrderPosition.company || '',
    job_title: updatedOrderPosition.job_title || '',
    orderPositionId: updatedOrderPosition.id || message.value?.orderPositionId || null
  }
}

const patchAttendeeDetails = async (orderPositionId, payload) => {
  const endpoint = `${String(url).replace(/\/+$/, '')}/api/v1/organizers/${organizer}/events/${eventSlug}/orderpositions/${orderPositionId}/`
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `Device ${apitoken}`,
      Accept: 'application/json, text/javascript',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    let errorMessage = `Unable to update attendee details (status ${response.status})`
    try {
      const errorBody = await response.json()
      if (errorBody?.detail || errorBody?.message) {
        errorMessage = errorBody.detail || errorBody.message
      }
    } catch (error) {
      // Keep the default message when error body is not JSON
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

const resolveOrderPositionId = async (knownOrderPositionId, attendeeSecret) => {
  if (knownOrderPositionId) {
    return knownOrderPositionId
  }

  const normalizedSecret = String(attendeeSecret || '').trim()
  if (!normalizedSecret) {
    return null
  }

  const params = new URLSearchParams({
    search: normalizedSecret,
    page_size: '50'
  })
  const response = await api.get(
    `api/v1/organizers/${organizer}/events/${eventSlug}/orderpositions/?${params.toString()}`
  )
  const exactMatch = (response.results || []).find(
    (orderPosition) => String(orderPosition.secret || '').trim() === normalizedSecret
  )

  return exactMatch?.id || null
}

const saveAttendeeAndCheckIn = async () => {
  if (isSavingAttendee.value) {
    return
  }

  const attendeeSecret = message.value?.secret
  if (!attendeeSecret) {
    editError.value = 'Attendee details are missing for this scan.'
    return
  }

  isSavingAttendee.value = true
  editError.value = ''

  try {
    const orderPositionId = await resolveOrderPositionId(
      message.value?.orderPositionId,
      attendeeSecret
    )

    const patchPayload = getModifiedAttendeeFields()
    if (Object.keys(patchPayload).length > 0) {
      if (!orderPositionId) {
        throw new Error('Unable to determine attendee record for update.')
      }
      const updatedOrderPosition = await patchAttendeeDetails(orderPositionId, patchPayload)
      if (
        updatedOrderPosition?.id &&
        String(updatedOrderPosition.id) !== String(orderPositionId)
      ) {
        throw new Error('Received invalid attendee update response.')
      }
      updatePopupAttendee(updatedOrderPosition)
      updateOrderInSearchResults(updatedOrderPosition)
    }

    const checkInResponse = await processEventyayCheckInStore.checkInBySecret(attendeeSecret)
    if (!checkInResponse || (checkInResponse.status !== 'ok' && checkInResponse.status !== 'redeemed')) {
      throw new Error('Attendee updated, but check-in failed.')
    }

    isEditDialogOpen.value = false
    startPopupCountdown()
  } catch (error) {
    console.error('Error saving attendee details:', error)
    editError.value = error?.message || 'Unable to save attendee details.'
  } finally {
    isSavingAttendee.value = false
  }
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

onMounted(async () => {
  try {
    await liveRegistrationStore.fetchProducts()
    resetLiveRegistrationForm()
  } catch (error) {
    console.error('Error loading products:', error)
    notificationStore.addNotification(['Error', 'Unable to load products for live registration'], 'error')
  }
})

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
  order.attendee_name = response.position?.attendee_name || order.attendee_name
  order.attendee_email = response.position?.attendee_email || order.attendee_email
  order.company = response.position?.company || order.company || ''
  order.job_title = response.position?.job_title || order.job_title || ''
}

</script>
<template>
  <div class="flex h-screen justify-center">
    <div class="flex w-1/2 flex-col items-center justify-center gap-4">
      <QRCamera qr-type="eventyaycheckin" scan-type="Check-In" />
      <button
        type="button"
        class="rounded bg-success px-4 py-2 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="isLoadingProducts || !products.length"
        @click="openLiveRegistrationDialog"
      >
        Live Registration
      </button>
      <p v-if="isLoadingProducts" class="text-sm text-gray-500">Loading products...</p>
      <p v-else-if="!products.length" class="text-sm text-danger">No products available</p>
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
      v-if="isLiveRegistrationDialogOpen"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-60"
    >
      <div class="w-full max-w-md rounded bg-white p-5 shadow-lg">
        <h3 class="mb-4 text-lg font-semibold">Register Attendee</h3>

        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-sm font-medium">Attendee Name</label>
            <input
              v-model="liveRegistrationForm.attendee_name"
              type="text"
              class="w-full rounded border p-2"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Attendee Email</label>
            <input
              v-model="liveRegistrationForm.attendee_email"
              type="email"
              class="w-full rounded border p-2"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Company</label>
            <input
              v-model="liveRegistrationForm.company"
              type="text"
              class="w-full rounded border p-2"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Job_Title</label>
            <input
              v-model="liveRegistrationForm.job_title"
              type="text"
              class="w-full rounded border p-2"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Product</label>
            <select v-model="liveRegistrationForm.product_id" class="w-full rounded border p-2">
              <option disabled value="">Select Product</option>
              <option v-for="product in products" :key="product.id" :value="String(product.id)">
                {{ getProductDisplayLabel(product) }}
              </option>
            </select>
          </div>
        </div>

        <p v-if="liveRegistrationError" class="mt-3 text-sm text-danger">
          {{ liveRegistrationError }}
        </p>

        <div class="mt-4 flex items-center justify-end gap-2">
          <StandardButton
            type="button"
            text="Cancel"
            class="btn-white"
            :disabled="isRegistering"
            @click="closeLiveRegistrationDialog"
          />
          <StandardButton
            type="button"
            :text="isRegistering ? 'Registering...' : 'Register and Mark Paid'"
            class="btn-primary"
            :disabled="isRegistering"
            @click="submitLiveRegistration"
          />
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
          <p><b>Name:</b> {{ message.attendee_name || message.attendee }}</p>
          <p><b>Email:</b> {{ message.attendee_email || 'Not provided' }}</p>
          <p v-if="message.company"><b>Company:</b> {{ message.company }}</p>
          <p v-if="message.job_title"><b>Job Title:</b> {{ message.job_title }}</p>
          <div class="mt-4 flex flex-col space-y-3">
            <StandardButton
              v-if="badgeUrl && showSuccess"
              type="button"
              text="Generate Badge"
              class="btn-primary w-full justify-center"
              @click="openBadgePreview"
            />
            <div class="mt-6 flex items-center gap-2">
              <button
                v-if="message?.secret || message?.orderPositionId"
                type="button"
                class="inline-flex items-center rounded bg-success px-3 py-2 text-white hover:opacity-90"
                aria-label="Edit attendee details"
                @click="openEditDialog"
              >
                <PencilSquareIcon class="h-5 w-5" />
              </button>
              <StandardButton
                type="button"
                text="Done"
                class="btn-info justify-center"
                @click="closePopup"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="isEditDialogOpen"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-60"
    >
      <div class="w-full max-w-md rounded bg-white p-5 shadow-lg">
        <h3 class="mb-4 text-lg font-semibold">Edit Attendee</h3>
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-sm font-medium">Attendee Name</label>
            <input v-model="editableAttendee.attendee_name" type="text" class="w-full rounded border p-2" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Attendee Email</label>
            <input v-model="editableAttendee.attendee_email" type="email" class="w-full rounded border p-2" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Company</label>
            <input v-model="editableAttendee.company" type="text" class="w-full rounded border p-2" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Job Title</label>
            <input v-model="editableAttendee.job_title" type="text" class="w-full rounded border p-2" />
          </div>
        </div>
        <p v-if="editError" class="mt-3 text-sm text-danger">{{ editError }}</p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <StandardButton
            type="button"
            text="Cancel"
            class="btn-white"
            :disabled="isSavingAttendee"
            @click="closeEditDialog"
          />
          <StandardButton
            type="button"
            :text="isSavingAttendee ? 'Saving...' : 'Save and Checkin'"
            class="btn-primary"
            :disabled="isSavingAttendee"
            @click="saveAttendeeAndCheckIn"
          />
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

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useEventyayEventStore } from '@/stores/eventyayEvent'
import { useleedauth } from '@/stores/leedauth'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { useLoadingStore } from '@/stores/loading'
import { getRoleRouteName } from '@/utils/session'
import { MagnifyingGlassIcon, CalendarDaysIcon } from '@heroicons/vue/24/outline'

const exhibitorTab = ref('upcoming')

const EVENTS_PER_PAGE = 8

const loadingStore = useLoadingStore()
const router = useRouter()
const processApi = useEventyayApi()
const leedauth = useleedauth()
const eventyayEventStore = useEventyayEventStore()
const { selectedRole, limitCheckInLists } = storeToRefs(processApi)
const { events, error } = storeToRefs(eventyayEventStore)

const selectedEvent = ref('')
const searchQuery = ref('')
const currentPage = ref(1)

const processEventyayCheckInStore = useProcessEventyayCheckInStore()
const { availableCheckInLists } = storeToRefs(processEventyayCheckInStore)
const selectedCheckInListId = ref(null)
const loadingLists = ref(false)

watch(selectedEvent, async (newVal) => {
  selectedCheckInListId.value = null
  if (!newVal) {
    processEventyayCheckInStore.invalidateCheckInListCache()
    return
  }
  loadingLists.value = true
  try {
    const eventData = events.value.find((event) => event.slug === newVal)
    processApi.setEvent(newVal, eventData ? getEventName(eventData) : '')
    await processEventyayCheckInStore.getCheckInLists({ force: true })
    if (availableCheckInLists.value.length === 1) {
      selectedCheckInListId.value = availableCheckInLists.value[0].id
    }
  } catch (error) {
    console.error('Error fetching check-in lists:', error)
  } finally {
    loadingLists.value = false
  }
})

onMounted(() => {
  processApi.refreshServerUrl()
  eventyayEventStore.fetchEvents()
  loadingStore.contentLoaded()
})

const getEventName = (event) => {
  if (typeof event?.name === 'string') {
    return event.name
  }

  if (event?.name && typeof event.name === 'object') {
    return event.name.en || Object.values(event.name)[0] || event.slug || 'Unnamed Event'
  }

  return event?.slug || 'Unnamed Event'
}

const formatEventDate = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

const categorizedEvents = computed(() => {
  const now = new Date()
  let filteredEvents = events.value

  if (selectedRole.value === 'Exhibitor') {
    filteredEvents = events.value.filter(
      (event) => event.plugins && event.plugins.includes('exhibition')
    )
  }

  if (selectedRole.value === 'CheckIn' || selectedRole.value === 'Badge Station') {
    return {
      upcoming: filteredEvents.filter((event) => new Date(event.date_to) >= now),
      past: []
    }
  }

  return {
    upcoming: filteredEvents.filter((event) => new Date(event.date_to) > now),
    past: filteredEvents.filter((event) => new Date(event.date_to) <= now)
  }
})

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase())

const filteredCategorizedEvents = computed(() => {
  if (!normalizedSearchQuery.value) {
    return categorizedEvents.value
  }

  const matches = (event) => {
    const eventName = getEventName(event).toLowerCase()
    const eventSlug = (event.slug || '').toLowerCase()
    return (
      eventName.includes(normalizedSearchQuery.value) ||
      eventSlug.includes(normalizedSearchQuery.value)
    )
  }

  return {
    upcoming: categorizedEvents.value.upcoming.filter(matches),
    past: categorizedEvents.value.past.filter(matches)
  }
})

const flattenedFilteredEvents = computed(() => [
  ...filteredCategorizedEvents.value.upcoming.map((event) => ({ event, section: 'upcoming' })),
  ...filteredCategorizedEvents.value.past.map((event) => ({ event, section: 'past' }))
])

const totalPages = computed(() =>
  Math.max(1, Math.ceil(flattenedFilteredEvents.value.length / EVENTS_PER_PAGE))
)

const paginatedFlattenedEvents = computed(() => {
  const startIndex = (currentPage.value - 1) * EVENTS_PER_PAGE
  return flattenedFilteredEvents.value.slice(startIndex, startIndex + EVENTS_PER_PAGE)
})

const paginatedEvents = computed(() => {
  const upcoming = []
  const past = []

  paginatedFlattenedEvents.value.forEach(({ event, section }) => {
    if (section === 'upcoming') {
      upcoming.push(event)
    } else {
      past.push(event)
    }
  })

  return { upcoming, past }
})

const visibleEvents = computed(() => {
  if (selectedRole.value !== 'Exhibitor') {
    return paginatedEvents.value
  }
  if (exhibitorTab.value === 'past') {
    return { upcoming: [], past: paginatedEvents.value.past }
  }
  return { upcoming: paginatedEvents.value.upcoming, past: [] }
})

const showPagination = computed(() => flattenedFilteredEvents.value.length > EVENTS_PER_PAGE)
const hasPreviousPage = computed(() => currentPage.value > 1)
const hasNextPage = computed(() => currentPage.value < totalPages.value)

watch(searchQuery, () => {
  currentPage.value = 1
})

watch(totalPages, (pages) => {
  if (currentPage.value > pages) {
    currentPage.value = pages
  }
})

watch(flattenedFilteredEvents, (eventList) => {
  if (!selectedEvent.value) {
    return
  }

  const visibleSlugs = new Set(eventList.map(({ event }) => event.slug))
  if (!visibleSlugs.has(selectedEvent.value)) {
    selectedEvent.value = ''
  }
})

const getCheckInListLabel = (list) => {
  const eventName = getEventName(events.value.find((event) => event.slug === selectedEvent.value))
  if (eventName) {
    return `${list.name} - ${eventName}`
  }
  return list.name
}

const checkInListEmptyMessage = computed(() => {
  if (limitCheckInLists.value?.length) {
    return 'No check-in lists match this device restriction for the selected event. Update the device settings in the organizer dashboard.'
  }
  return 'No check-in lists found for this event. Create a check-in list in the event settings first.'
})

const submitForm = async () => {
  if (!selectedEvent.value) {
    return
  }

  const selectedEventData = events.value.find((event) => event.slug === selectedEvent.value)
  if (!selectedEventData) {
    return
  }

  processApi.setEvent(selectedEventData.slug, getEventName(selectedEventData))
  if (selectedRole.value !== 'Exhibitor' && selectedCheckInListId.value) {
    processApi.setSelectedCheckInListId(selectedCheckInListId.value)
  }

  if (selectedRole.value === 'Exhibitor' && processApi.pendingExhibitorKey) {
    const response = await leedauth.loginWithPendingKey()
    if (response.success) {
      router.push({ name: 'leadscan' })
      return
    }
  }

  const routeName = getRoleRouteName(selectedRole.value)
  if (routeName) {
    router.push({ name: routeName })
  }
}
</script>

<template>
  <div class="page-shell py-8">
    <div class="mx-auto max-w-2xl">
      <div class="mb-6 text-center">
        <h1>
          {{ selectedRole === 'Exhibitor' ? 'Select exhibitor event' : 'Select event' }}
        </h1>
        <p class="mt-2 text-sm text-body-muted">Choose the event you are working on today.</p>
      </div>

      <div v-if="error" class="mb-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
        {{ error }}
      </div>

      <form v-if="events.length" class="card p-5 sm:p-6" @submit.prevent="submitForm">
        <div v-if="selectedRole === 'Exhibitor'" class="mb-5 flex gap-2 border-b border-surface-border pb-4">
          <button
            type="button"
            class="rounded-full px-4 py-2 text-sm font-semibold transition"
            :class="exhibitorTab === 'upcoming' ? 'bg-primary text-white' : 'bg-surface-muted text-body-muted'"
            @click="exhibitorTab = 'upcoming'"
          >
            Current / Upcoming
          </button>
          <button
            type="button"
            class="rounded-full px-4 py-2 text-sm font-semibold transition"
            :class="exhibitorTab === 'past' ? 'bg-primary text-white' : 'bg-surface-muted text-body-muted'"
            @click="exhibitorTab = 'past'"
          >
            Past
          </button>
        </div>

        <div class="relative mb-5">
          <MagnifyingGlassIcon class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-body-muted" />
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search by name or slug..."
            class="pl-10"
          />
        </div>

        <div v-if="visibleEvents.upcoming.length" class="mb-5">
          <p class="section-title mb-3">Upcoming / current</p>
          <div class="space-y-2">
            <label
              v-for="event in visibleEvents.upcoming"
              :key="event.slug"
              class="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition"
              :class="selectedEvent === event.slug ? 'border-primary bg-primary/5' : 'border-surface-border hover:border-primary/30'"
            >
              <input v-model="selectedEvent" type="radio" :value="event.slug" class="mt-1" />
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-body">{{ getEventName(event) }}</p>
                <p class="mt-1 flex items-center gap-1.5 text-xs text-body-muted">
                  <CalendarDaysIcon class="h-4 w-4 shrink-0" />
                  {{ formatEventDate(event.date_from) }}
                </p>
              </div>
            </label>
          </div>
        </div>

        <div v-if="selectedRole === 'Exhibitor' && visibleEvents.past.length" class="mb-5">
          <p class="section-title mb-3">Past events</p>
          <div class="space-y-2">
            <label
              v-for="event in visibleEvents.past"
              :key="event.slug"
              class="flex cursor-pointer items-start gap-3 rounded-xl border border-surface-border p-4 transition hover:border-primary/30"
            >
              <input v-model="selectedEvent" type="radio" :value="event.slug" class="mt-1" />
              <div>
                <p class="font-medium text-body">{{ getEventName(event) }}</p>
                <p class="mt-1 text-xs text-body-muted">{{ formatEventDate(event.date_from) }}</p>
              </div>
            </label>
          </div>
        </div>

        <div
          v-if="!visibleEvents.upcoming.length && !visibleEvents.past.length"
          class="rounded-xl border border-dashed border-surface-border px-4 py-8 text-center text-sm text-body-muted"
        >
          No events match your search.
        </div>

        <div v-if="showPagination" class="mb-4 flex items-center justify-between text-sm text-body-muted">
          <button
            type="button"
            class="btn-white px-3 py-1.5"
            :disabled="!hasPreviousPage"
            @click="currentPage = Math.max(1, currentPage - 1)"
          >
            Previous
          </button>
          <span>Page {{ currentPage }} of {{ totalPages }}</span>
          <button
            type="button"
            class="btn-white px-3 py-1.5"
            :disabled="!hasNextPage"
            @click="currentPage = Math.min(totalPages, currentPage + 1)"
          >
            Next
          </button>
        </div>

        <!-- Check-in List Selector -->
        <div v-if="selectedEvent && selectedRole !== 'Exhibitor'" class="border-t border-surface-border mt-5 pt-5 mb-5">
          <p class="section-title mb-3">Select check-in list</p>
          <div v-if="loadingLists" class="text-xs text-body-muted flex items-center gap-2">
            <span class="animate-spin rounded-full h-3.5 w-3.5 border-2 border-primary border-t-transparent"></span>
            Loading lists...
          </div>
          <div v-else-if="availableCheckInLists.length" class="space-y-2">
            <label
              v-for="list in availableCheckInLists"
              :key="list.id"
              class="flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition"
              :class="selectedCheckInListId === list.id ? 'border-primary bg-primary/5' : 'border-surface-border hover:border-primary/30'"
            >
              <input v-model="selectedCheckInListId" type="radio" :value="list.id" />
              <div>
                <p class="font-medium text-body">{{ getCheckInListLabel(list) }}</p>
                <p v-if="list.all_products" class="mt-1 text-xs text-body-muted">All products allowed</p>
                <p v-else class="mt-1 text-xs text-body-muted">Restricted products list</p>
              </div>
            </label>
          </div>
          <div v-else class="rounded-xl border border-dashed border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger">
            {{ checkInListEmptyMessage }}
          </div>
        </div>

        <StandardButton
          type="submit"
          text="Continue"
          class="btn-primary w-full justify-center py-2.5"
          :disabled="!selectedEvent || (selectedRole !== 'Exhibitor' && !selectedCheckInListId)"
        />
      </form>

      <div v-else-if="!error" class="card p-8 text-center">
        <p class="text-body-muted">No events available for this organizer.</p>
        <StandardButton
          text="Refresh"
          class="btn-primary mx-auto mt-4 justify-center"
          @click="eventyayEventStore.fetchEvents()"
        />
      </div>
    </div>
  </div>
</template>

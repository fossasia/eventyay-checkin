<script setup>
import { useLoadingStore } from '@/stores/loading'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useEventyayEventStore } from '@/stores/eventyayEvent'

import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useRouter } from 'vue-router'

const EVENTS_PER_PAGE = 8

const loadingStore = useLoadingStore()
const router = useRouter()

const selectedEvent = ref(null)
const searchQuery = ref('')
const currentPage = ref(1)
const processApi = useEventyayApi()
const { apitoken, url, organizer, selectedRole } = processApi
const eventyayEventStore = useEventyayEventStore()
onMounted(() => {
  eventyayEventStore.fetchEvents(url, apitoken, organizer)
})
const { events, error } = storeToRefs(eventyayEventStore)


loadingStore.contentLoaded()

const getEventName = (event) => {
  if (typeof event?.name === 'string') {
    return event.name
  }

  if (event?.name && typeof event.name === 'object') {
    return event.name.en || Object.values(event.name)[0] || event.slug || 'Unnamed Event'
  }

  return event?.slug || 'Unnamed Event'
}

// Format date with timezone indication
const formatEventDate = (dateString) => {
  const date = new Date(dateString)
  const localDate = date.toLocaleDateString()
  const localTime = date.toLocaleTimeString()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `${localDate} ${localTime} (${timeZone})`
}

// Filter events based on selectedRole and date
const categorizedEvents = computed(() => {
  const now = new Date()
  let filteredEvents = events.value

  // Filter for exhibitor events if role is Exhibitor
  if (selectedRole === 'Exhibitor') {
    filteredEvents = events.value.filter((event) => event.plugins && event.plugins.includes('exhibition'))
  }

  // For CheckIn or Badge Station, only show upcoming events
  if (selectedRole === 'CheckIn' || selectedRole === 'Badge Station') {
    return {
      upcoming: filteredEvents.filter((event) => new Date(event.date_to) >= now),
      past: [] // Empty array as we don't want to show past events
    }
  }

  // For Exhibitor role, show both past and upcoming events
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
    return eventName.includes(normalizedSearchQuery.value) || eventSlug.includes(normalizedSearchQuery.value)
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
    selectedEvent.value = null
  }
})

const goToPreviousPage = () => {
  currentPage.value = Math.max(1, currentPage.value - 1)
}

const goToNextPage = () => {
  currentPage.value = Math.min(totalPages.value, currentPage.value + 1)
}

const submitForm = () => {
  if (!selectedEvent.value) {
    console.error('Please select an event.')
    return
  }

  const selectedEventData = events.value.find(event => event.slug === selectedEvent.value)

  if (!selectedEventData) {
    console.error('Event not found.')
    return
  }

  processApi.setEvent(selectedEventData.slug, getEventName(selectedEventData))

  const routeMap = {
    'Exhibitor': 'eventyayleedlogin',
    'Badge Station': 'eventyaysearchcheckin',
    'CheckIn': 'eventyaycheckin'
  }

  const routeName = routeMap[processApi.selectedRole]
  if (routeName) {
    router.push({ name: routeName })
  } else {
    console.warn('Unhandled role:', selectedRole)
  }
}

</script>

<template>
  <div class="-mt-16 flex h-screen flex-col items-center justify-center">
    <div v-if="error" class="text-danger">{{ error }}</div>
    <form v-if="events.length" @submit.prevent="submitForm">
      <!-- Role-specific heading -->
      <div class="mb-4 text-center">
        <h1 class="text-xl font-bold">
          {{
            selectedRole === 'Exhibitor' ? 'Exhibitor Events' : 'Select Event to Perform Checkin'
          }}
        </h1>
      </div>

      <div class="mb-4">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search events by name or slug..."
          class="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
      </div>

      <!-- Upcoming Events Section -->
      <div v-if="paginatedEvents.upcoming.length" class="mb-6">
        <h2 class="mb-3 text-center text-lg font-semibold">Upcoming/Current Events</h2>
        <div v-for="event in paginatedEvents.upcoming" :key="event.slug" class="mb-2">
          <label class="flex items-center space-x-2">
            <input v-model="selectedEvent" type="radio" :value="event.slug" />
            <span class="text-xl">
              {{ getEventName(event) }}
              <div class="text-gray-600 text-sm">
                {{ formatEventDate(event.date_from) }}
              </div>
            </span>
          </label>
        </div>
      </div>

      <!-- Past Events Section - Only shown for Exhibitor role -->
      <div v-if="selectedRole === 'Exhibitor' && paginatedEvents.past.length" class="mb-6">
        <h2 class="mb-3 text-center text-lg font-semibold">Past Events</h2>
        <div v-for="event in paginatedEvents.past" :key="event.slug" class="mb-2">
          <label class="flex items-center space-x-2">
            <input v-model="selectedEvent" type="radio" :value="event.slug" />
            <span class="text-lg">
              {{ getEventName(event) }}
              <div class="text-gray-600 text-sm">
                {{ formatEventDate(event.date_from) }}
              </div>
            </span>
          </label>
        </div>
      </div>

      <div
        v-if="!paginatedEvents.upcoming.length && !paginatedEvents.past.length"
        class="mb-6 rounded border border-gray-200 p-4 text-center text-gray-500"
      >
        No events match your search.
      </div>

      <div v-if="showPagination" class="mb-2 flex items-center justify-between">
        <button
          v-if="hasPreviousPage"
          type="button"
          aria-label="Previous page"
          class="text-xl leading-none text-black"
          @click="goToPreviousPage"
        >
          ‹
        </button>
        <div v-else class="h-8 w-8"></div>

        <p class="text-sm text-gray-600">Page {{ currentPage }} of {{ totalPages }}</p>

        <button
          v-if="hasNextPage"
          type="button"
          aria-label="Next page"
          class="text-xl leading-none text-black"
          @click="goToNextPage"
        >
          ›
        </button>
        <div v-else class="h-8 w-8"></div>
      </div>

      <div>
        <StandardButton
          type="submit"
          text="Select Event"
          class="btn-primary mt-6 w-full justify-center"
        />
      </div>
    </form>

    <div v-if="!events.length && !error" class="text-center">
      <div class="mb-4">No events available</div>
      <StandardButton
        text="Refresh"
        class="btn-primary mt-6 w-1/2 justify-center"
        @click="eventyayEventStore.fetchEvents(url, apitoken, organizer)"
      />
    </div>
  </div>
</template>

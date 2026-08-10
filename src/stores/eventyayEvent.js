import { createAuthorizedDeviceApi } from '@/utils/serverUrl'
import { getDeviceErrorMessage, handleDeviceApiError } from '@/utils/deviceErrors'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useEventyayApi } from '@/stores/eventyayapi'

export const useEventyayEventStore = defineStore('eventyayEvent', () => {
  const events = ref([])
  const error = ref(null)

  async function fetchEvents() {
    error.value = null

    const processApi = useEventyayApi()
    processApi.refreshServerUrl()

    const url = processApi.url
    const apiToken = processApi.apitoken
    const organizer = processApi.organizer

    if (!url || !apiToken || !organizer) {
      error.value = 'Device is not configured. Please register this device again.'
      return
    }

    try {
      const api = createAuthorizedDeviceApi(url, apiToken)
      const response = await api.get(`/api/v1/organizers/${organizer}/events/`)
      events.value = response.results
    } catch (err) {
      if (
        handleDeviceApiError(err, processApi, {
          onProfileDenied: (msg) => {
            error.value = msg
          }
        })
      ) {
        return
      }
      error.value = getDeviceErrorMessage(err, err.message)
    }
  }

  return {
    events,
    error,
    fetchEvents
  }
})

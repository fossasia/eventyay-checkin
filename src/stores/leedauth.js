import { useEventyayApi } from '@/stores/eventyayapi'
import { createAuthorizedDeviceApi, exhibitorApiPath } from '@/utils/serverUrl'
import { defineStore } from 'pinia'

export const useleedauth = defineStore('leedauth', () => {
  async function leedlogin(payload) {
    const processApi = useEventyayApi()
    processApi.refreshServerUrl()

    const url = processApi.url
    const apitoken = processApi.apitoken
    const organizer = processApi.organizer
    const eventSlug = processApi.eventSlug

    if (!url || !apitoken || !organizer || !eventSlug) {
      return { success: false }
    }

    try {
      const api = createAuthorizedDeviceApi(url, apitoken, { Accept: 'application/json' })
      const response = await api.post(exhibitorApiPath(organizer, eventSlug, 'auth'), payload)
      if (response.success) {
        processApi.setExhibitor(
          payload.key,
          response.exhibitor_name,
          response.booth_name,
          response.booth_id
        )
      }

      return response
    } catch (error) {
      console.error('Exhibitor login failed:', error)
      return { success: false }
    }
  }

  return { leedlogin }
})

import { useEventyayApi } from '@/stores/eventyayapi'
import { createAuthorizedDeviceApi, exhibitorApiPath } from '@/utils/serverUrl'
import {
  getDeviceErrorMessage,
  getExhibitorErrorMessage,
  isDeviceProfileDenied,
  LEAD_SCAN_PROFILE_DENIED_MESSAGE
} from '@/utils/deviceErrors'
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
      return {
        success: false,
        error: 'Device or event is not configured. Register the device and select an event first.'
      }
    }

    const exhibitorKey = String(payload?.key || '').trim()
    if (!exhibitorKey) {
      return { success: false, error: 'Enter your exhibitor key.' }
    }

    try {
      const api = createAuthorizedDeviceApi(url, apitoken, { Accept: 'application/json' })
      const response = await api.post(exhibitorApiPath(organizer, eventSlug, 'auth'), {
        key: exhibitorKey
      })

      if (!response?.success) {
        return {
          success: false,
          error: String(response?.error || 'Invalid exhibitor key or exhibitor not found.')
        }
      }

      processApi.setExhibitor(
        exhibitorKey,
        response.exhibitor_name,
        response.booth_name,
        response.booth_id
      )

      return response
    } catch (error) {
      console.error('Exhibitor login failed:', error)

      if (isDeviceProfileDenied(error)) {
        return {
          success: false,
          error: LEAD_SCAN_PROFILE_DENIED_MESSAGE
        }
      }

      const status = error?.response?.status ?? error?.status ?? 0
      if (status === 401 || status === 403) {
        return {
          success: false,
          error: getExhibitorErrorMessage(error, 'Exhibitor sign-in failed.')
        }
      }

      return {
        success: false,
        error: getDeviceErrorMessage(error, 'Exhibitor sign-in failed.')
      }
    }
  }

  async function loginWithPendingKey() {
    const processApi = useEventyayApi()
    const pendingKey = String(processApi.pendingExhibitorKey || '').trim()
    if (!pendingKey) {
      return { success: false, skipped: true }
    }

    const response = await leedlogin({ key: pendingKey })
    processApi.setPendingExhibitorKey('')
    return response
  }

  return { leedlogin, loginWithPendingKey }
})

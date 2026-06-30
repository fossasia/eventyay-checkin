import { defineStore } from 'pinia'
import { ref } from 'vue'
import router from '@/router'
import { deviceApi, createAuthorizedDeviceApi, resolveServerUrl } from '@/utils/serverUrl'

export const useEventyayApi = defineStore(
  'processApi',
  () => {
    const apitoken = ref('')
    const url = ref('')
    const organizer = ref('')
    const eventSlug = ref('')
    const eventname = ref('')
    const exikey = ref('')
    const selectedRole = ref('')
    const exhiname = ref('')
    const boothname = ref('')
    const boothid = ref('')
    const limitCheckInLists = ref([])
    const selectedCheckInListId = ref(null)
    const isRegistering = ref(false)
    const deviceName = ref('')
    const gateName = ref('')

    function $reset() {
      apitoken.value = ''
      url.value = ''
      organizer.value = ''
      eventSlug.value = ''
      eventname.value = ''
      exikey.value = ''
      selectedRole.value = ''
      exhiname.value = ''
      boothname.value = ''
      boothid.value = ''
      limitCheckInLists.value = []
      selectedCheckInListId.value = null
      isRegistering.value = false
      deviceName.value = ''
      gateName.value = ''
    }

    function parseRegistrationError(error) {
      const body = error?.body
      if (typeof body === 'string' && body) {
        return body
      }
      if (body && typeof body === 'object') {
        if (body.token) {
          const tokenError = Array.isArray(body.token) ? body.token[0] : body.token
          const message = String(tokenError)
          if (message.toLowerCase().includes('already been used')) {
            return 'This setup code has already been used. Generate a new code in the organizer device settings and try again.'
          }
          return message
        }
        if (body.detail) {
          return String(body.detail)
        }
        if (body.non_field_errors) {
          const msg = Array.isArray(body.non_field_errors) ? body.non_field_errors[0] : body.non_field_errors
          return String(msg)
        }
        const firstKey = Object.keys(body)[0]
        if (firstKey) {
          const val = body[firstKey]
          const msg = Array.isArray(val) ? val[0] : val
          if (msg) {
            return String(msg)
          }
        }
      }
      if (!error?.response && (error?.message === 'Failed to fetch' || error?.name === 'TypeError')) {
        return 'Could not reach the server. Use the same host for the check-in app and API (e.g. both localhost or both 127.0.0.1).'
      }
      return ''
    }

    function setApiCred(newToken, newUrl, newOrg) {
      apitoken.value = newToken
      url.value = resolveServerUrl(newUrl)
      organizer.value = newOrg
    }

    function refreshServerUrl() {
      if (url.value) {
        url.value = resolveServerUrl(url.value)
      }
    }

    function setDeviceInfo({ name, gate } = {}) {
      deviceName.value = name ? String(name) : ''
      gateName.value = gate?.name ? String(gate.name) : ''
    }

    function setEvent(slug, name) {
      eventSlug.value = slug
      eventname.value = name
      selectedCheckInListId.value = null
    }

    function setLimitCheckInLists(listIds) {
      limitCheckInLists.value = Array.isArray(listIds) ? listIds.map(Number) : []
      selectedCheckInListId.value = null
    }

    function setSelectedCheckInListId(id) {
      selectedCheckInListId.value = id
    }

    function setExhibitor(key, name, booth, bid) {
      exikey.value = key
      exhiname.value = name
      boothname.value = booth
      boothid.value = bid
    }

    function setRole(role) {
      selectedRole.value = role
    }

    function logout({ clearRole = true } = {}) {
      const preservedRole = selectedRole.value

      apitoken.value = ''
      url.value = ''
      organizer.value = ''
      eventSlug.value = ''
      eventname.value = ''
      exikey.value = ''
      exhiname.value = ''
      boothname.value = ''
      boothid.value = ''
      limitCheckInLists.value = []
      selectedCheckInListId.value = null
      deviceName.value = ''
      gateName.value = ''

      if (!clearRole) {
        selectedRole.value = preservedRole
      } else {
        selectedRole.value = ''
      }

      if (router) {
        router.push({ name: 'userAuth' })
      }

      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('eventyay-badge-station-kiosk-ack')
      }
    }

    function handleAuthError() {
      logout({ clearRole: false })
    }

    async function initializeDevice(serverUrl, token) {
      const cleanUrl = resolveServerUrl(serverUrl)
      const cleanToken = String(token || '').trim()
      if (!cleanUrl || !cleanToken) {
        return { success: false, error: 'invalid_qr' }
      }

      try {
        new URL(cleanUrl)
      } catch {
        return { success: false, error: 'invalid_url' }
      }

      const payload = {
        token: cleanToken,
        hardware_brand: 'Browser',
        hardware_model: 'Web Client',
        software_brand: 'eventyay-checkin',
        software_version: '1.0'
      }
      const api = deviceApi(cleanUrl, { headers: { 'Content-Type': 'application/json' } })
      const response = await api.post('/api/v1/device/initialize', payload)
      if (response && response.api_token) {
        setApiCred(response.api_token, cleanUrl, response.organizer)
        setLimitCheckInLists(response.limit_checkin_lists || [])
        setDeviceInfo({ name: response.name, gate: response.gate })
        return { success: true }
      }
      return { success: false, error: 'registration_failed' }
    }

    async function registerDeviceByQr(qrString) {
      if (isRegistering.value) {
        return { success: false, error: 'registration_in_progress' }
      }

      isRegistering.value = true
      try {
        let qrData
        try {
          qrData = JSON.parse(String(qrString || '').trim())
        } catch {
          console.error('Device registration failed: QR payload is not valid JSON')
          return { success: false, error: 'invalid_qr' }
        }

        if (!qrData.url || !qrData.token) {
          console.error('Device registration failed: QR payload is missing url or token')
          return { success: false, error: 'invalid_qr' }
        }

        if (qrData.handshake_version && Number(qrData.handshake_version) > 1) {
          return { success: false, error: 'unsupported_handshake' }
        }

        return await initializeDevice(qrData.url, qrData.token)
      } catch (error) {
        const message = parseRegistrationError(error)
        console.error('Device registration failed:', error)
        return {
          success: false,
          error: 'registration_failed',
          message: message || 'Registration request was rejected by the server.'
        }
      } finally {
        isRegistering.value = false
      }
    }

    async function registerDeviceManually(inputUrl, token) {
      if (isRegistering.value) {
        return { success: false, error: 'registration_in_progress' }
      }

      isRegistering.value = true
      try {
        return await initializeDevice(inputUrl, token)
      } catch (error) {
        const message = parseRegistrationError(error)
        console.error('Device registration failed:', error)
        return {
          success: false,
          error: 'registration_failed',
          message: message || 'Registration request was rejected by the server.'
        }
      } finally {
        isRegistering.value = false
      }
    }

    async function syncDeviceInfo() {
      if (!apitoken.value || !url.value) {
        return
      }

      refreshServerUrl()

      try {
        const api = createAuthorizedDeviceApi(url.value, apitoken.value)
        const response = await api.post('/api/v1/device/update', {
          hardware_brand: 'Browser',
          hardware_model: 'Web Client',
          software_brand: 'eventyay-checkin',
          software_version: '1.0'
        })
        setDeviceInfo({ name: response.name, gate: response.gate })
      } catch {
        // Session polling will handle revoked tokens.
      }
    }

    return {
      $reset,
      setApiCred,
      setEvent,
      setExhibitor,
      selectedRole,
      setRole,
      logout,
      handleAuthError,
      registerDeviceByQr,
      registerDeviceManually,
      syncDeviceInfo,
      refreshServerUrl,
      apitoken,
      url,
      organizer,
      eventSlug,
      eventname,
      exikey,
      exhiname,
      boothname,
      boothid,
      limitCheckInLists,
      selectedCheckInListId,
      setLimitCheckInLists,
      setSelectedCheckInListId,
      isRegistering,
      deviceName,
      gateName,
      setDeviceInfo,
    }
  },
  {
    persist: true
  }
)

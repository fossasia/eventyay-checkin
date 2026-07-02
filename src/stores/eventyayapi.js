import { defineStore } from 'pinia'
import { ref } from 'vue'
import { redirectToUserAuth } from '@/utils/authRedirect'
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
    const securityProfile = ref('')

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
      securityProfile.value = ''
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
        return 'Could not reach the server. Open the check-in app from the same host as the device setup URL (e.g. https://dev.eventyay.com), or check network and CORS settings.'
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

    function setSecurityProfile(profile) {
      securityProfile.value = profile ? String(profile) : ''
    }

    function clearExhibitor() {
      exikey.value = ''
      exhiname.value = ''
      boothname.value = ''
      boothid.value = ''
    }

    function setEvent(slug, name) {
      if (eventSlug.value && eventSlug.value !== slug) {
        clearExhibitor()
      }
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
      exikey.value = String(key || '').trim()
      exhiname.value = name
      boothname.value = booth
      boothid.value = bid
    }

    function setRole(role) {
      selectedRole.value = role
    }

    function applyStationTypeChange(nextRole) {
      const previousRole = selectedRole.value
      if (!nextRole || previousRole === nextRole) {
        return
      }

      if (nextRole === 'Exhibitor') {
        selectedCheckInListId.value = null
        if (previousRole === 'CheckIn' || previousRole === 'Badge Station') {
          eventSlug.value = ''
          eventname.value = ''
        }
        return
      }

      clearExhibitor()
      if (previousRole === 'Exhibitor') {
        eventSlug.value = ''
        eventname.value = ''
        selectedCheckInListId.value = null
      }
    }

    function logout({ clearRole = true, redirect = true } = {}) {
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
      securityProfile.value = ''

      if (!clearRole) {
        selectedRole.value = preservedRole
      } else {
        selectedRole.value = ''
      }

      if (redirect) {
        redirectToUserAuth()
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
        setSecurityProfile(response.security_profile)
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
        setSecurityProfile(response.security_profile)
      } catch {
        // Session polling will handle revoked tokens.
      }
    }

    async function verifySetupToken(token) {
      const cleanToken = String(token || '').trim()
      if (!apitoken.value || !url.value || !cleanToken) {
        return { success: false, error: 'missing_credentials' }
      }

      refreshServerUrl()

      try {
        const api = createAuthorizedDeviceApi(url.value, apitoken.value)
        await api.post('/api/v1/device/verify-setup-token', { token: cleanToken })
        return { success: true }
      } catch (error) {
        const status = error?.response?.status
        const body = error?.body
        if (body?.token) {
          const tokenError = Array.isArray(body.token) ? body.token[0] : body.token
          return { success: false, error: 'invalid_token', message: String(tokenError) }
        }
        if (body?.detail) {
          return { success: false, error: 'verification_failed', message: String(body.detail) }
        }
        if (status === 403) {
          return {
            success: false,
            error: 'verification_failed',
            message: 'This device is not allowed to verify the setup token. Contact the organizer.'
          }
        }
        return { success: false, error: 'verification_failed' }
      }
    }

    return {
      $reset,
      setApiCred,
      setEvent,
      setExhibitor,
      selectedRole,
      setRole,
      applyStationTypeChange,
      logout,
      handleAuthError,
      registerDeviceByQr,
      registerDeviceManually,
      syncDeviceInfo,
      verifySetupToken,
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
      securityProfile,
      setSecurityProfile,
    }
  },
  {
    persist: true
  }
)

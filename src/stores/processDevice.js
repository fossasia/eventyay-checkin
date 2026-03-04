import { useApiStore } from '@/stores/api'
import { useCameraStore } from '@/stores/camera'
import { useEventyayApi } from '@/stores/eventyayapi'
import appPackage from '../../package.json'

import { mande } from 'mande'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

const UNKNOWN_VALUE = 'Unknown'
const APP_NAME = 'eventyay-event-checkin'
const APP_VERSION = appPackage.version || UNKNOWN_VALUE

const normalizeValue = (value, fallback = UNKNOWN_VALUE) => {
  if (typeof value === 'string') {
	const normalized = value.trim()
	return normalized || fallback
  }

  if (value !== null && value !== undefined) {
	const normalized = String(value).trim()
	return normalized || fallback
  }

  return fallback
}

const parseBrowserFromUserAgentData = (userAgentData, highEntropyValues) => {
  const brands =
	highEntropyValues?.fullVersionList?.length > 0
	  ? highEntropyValues.fullVersionList
	  : userAgentData?.brands || []

  if (brands.length === 0) {
	return null
  }

  const bestBrand = brands.find((brand) => !brand.brand.includes('Not')) || brands[0]
  return {
	name: normalizeValue(bestBrand.brand, 'Browser'),
	version: normalizeValue(bestBrand.version)
  }
}

const parseBrowserFromUserAgent = (userAgent) => {
  const browserMatchers = [
	{ name: 'Edge', regex: /Edg\/([\d.]+)/i },
	{ name: 'Samsung Internet', regex: /SamsungBrowser\/([\d.]+)/i },
	{ name: 'Opera', regex: /OPR\/([\d.]+)/i },
	{ name: 'Chrome', regex: /Chrome\/([\d.]+)/i },
	{ name: 'Firefox', regex: /Firefox\/([\d.]+)/i },
	{ name: 'Safari', regex: /Version\/([\d.]+).*Safari/i }
  ]

  for (const matcher of browserMatchers) {
	const matched = userAgent.match(matcher.regex)
	if (matched?.[1]) {
	  return {
		name: matcher.name,
		version: matched[1]
	  }
	}
  }

  return {
	name: 'Browser',
	version: UNKNOWN_VALUE
  }
}

const parseOsInfo = (userAgent, platformHint = '', platformVersionHint = '') => {
  const normalizedPlatform = platformHint.toLowerCase()

  if (/android/i.test(userAgent) || normalizedPlatform.includes('android')) {
	const matched = userAgent.match(/Android\s([\d.]+)/i)
	return {
	  name: 'Android',
	  version: platformVersionHint || matched?.[1] || UNKNOWN_VALUE
	}
  }

  if (/iPhone|iPad|iPod/i.test(userAgent) || normalizedPlatform.includes('ios')) {
	const matched = userAgent.match(/OS\s([\d_]+)/i)
	return {
	  name: /iPad/i.test(userAgent) ? 'iPadOS' : 'iOS',
	  version: (platformVersionHint || matched?.[1] || UNKNOWN_VALUE).replace(/_/g, '.')
	}
  }

  if (/Windows NT/i.test(userAgent) || normalizedPlatform.includes('windows')) {
	const matched = userAgent.match(/Windows NT\s([\d.]+)/i)
	return {
	  name: 'Windows',
	  version: platformVersionHint || matched?.[1] || UNKNOWN_VALUE
	}
  }

  if (/Mac OS X/i.test(userAgent) || normalizedPlatform.includes('mac')) {
	const matched = userAgent.match(/Mac OS X\s([\d_]+)/i)
	return {
	  name: 'macOS',
	  version: (platformVersionHint || matched?.[1] || UNKNOWN_VALUE).replace(/_/g, '.')
	}
  }

  if (/Linux/i.test(userAgent) || normalizedPlatform.includes('linux')) {
	return {
	  name: 'Linux',
	  version: platformVersionHint || UNKNOWN_VALUE
	}
  }

  return {
	name: normalizeValue(platformHint),
	version: normalizeValue(platformVersionHint)
  }
}

const parseHardwareModel = (userAgent, osName, modelHint = '', platformHint = '') => {
  if (modelHint.trim()) {
	return modelHint
  }

  if (osName === 'Android') {
	const matched = userAgent.match(/Android\s[\d.]+;\s*([^;)]*?)(?:\sBuild|\)|;)/i)
	if (matched?.[1]) {
	  return matched[1]
	}
  }

  if (/iPhone/i.test(userAgent)) {
	return 'iPhone'
  }

  if (/iPad/i.test(userAgent)) {
	return 'iPad'
  }

  if (/iPod/i.test(userAgent)) {
	return 'iPod'
  }

  if (osName === 'Windows') {
	return 'PC'
  }

  if (osName === 'macOS') {
	return 'Mac'
  }

  if (osName === 'Linux') {
	return 'Linux Device'
  }

  return normalizeValue(platformHint)
}

const parseHardwareBrand = (hardwareModel, userAgent, vendor = '') => {
  const model = hardwareModel || ''
  const brandMatchers = [
	{ regex: /^(SM-|GT-|SCH-|SAMSUNG|Galaxy)/i, brand: 'Samsung' },
	{ regex: /(Pixel|Nexus)/i, brand: 'Google' },
	{ regex: /(iPhone|iPad|iPod|Mac)/i, brand: 'Apple' },
	{ regex: /(Redmi|POCO|Xiaomi|Mi\s|Mi-)/i, brand: 'Xiaomi' },
	{ regex: /(OnePlus|CPH\d+)/i, brand: 'OnePlus' },
	{ regex: /(HUAWEI|Honor)/i, brand: 'Huawei' },
	{ regex: /(MOTO|Motorola)/i, brand: 'Motorola' },
	{ regex: /(Nokia)/i, brand: 'Nokia' },
	{ regex: /(Vivo)/i, brand: 'Vivo' },
	{ regex: /(OPPO)/i, brand: 'OPPO' },
	{ regex: /(Realme)/i, brand: 'Realme' }
  ]

  for (const matcher of brandMatchers) {
	if (matcher.regex.test(model)) {
	  return matcher.brand
	}
  }

  if (/iPhone|iPad|iPod|Mac/i.test(userAgent)) {
	return 'Apple'
  }

  const normalizedVendor = vendor.replace(/,?\s*Inc\.?$/i, '').trim()
  if (normalizedVendor && normalizedVendor.toLowerCase() !== 'google') {
	return normalizedVendor
  }

  return UNKNOWN_VALUE
}

const getSoftwareVersion = (browserVersion) => {
  if (APP_VERSION && APP_VERSION !== '0.0.0') {
    return APP_VERSION
  }

  return normalizeValue(browserVersion)
}

const getSoftwareBrand = (browserName) => {
  const normalizedBrowserName = normalizeValue(browserName, 'Browser')
  return `${APP_NAME} (${normalizedBrowserName})`
}

const getDeviceMetadata = async () => {
  if (typeof navigator === 'undefined') {
	return {
	  hardware_brand: UNKNOWN_VALUE,
	  hardware_model: UNKNOWN_VALUE,
	  os_name: UNKNOWN_VALUE,
	  os_version: UNKNOWN_VALUE,
	  software_brand: APP_NAME,
	  software_version: APP_VERSION
	}
  }

  const userAgent = navigator.userAgent || ''
  let highEntropyValues = {}

  if (navigator.userAgentData?.getHighEntropyValues) {
	try {
	  highEntropyValues = await navigator.userAgentData.getHighEntropyValues([
		'model',
		'platform',
		'platformVersion',
		'fullVersionList'
	  ])
	} catch (error) {
	  console.warn('Unable to read full device metadata from userAgentData', error)
	}
  }

  const platformHint = highEntropyValues.platform || navigator.userAgentData?.platform || navigator.platform || ''
  const osInfo = parseOsInfo(userAgent, platformHint, highEntropyValues.platformVersion || '')
  const hardwareModel = parseHardwareModel(
	userAgent,
	osInfo.name,
	highEntropyValues.model || '',
	platformHint
  )
  const hardwareBrand = parseHardwareBrand(hardwareModel, userAgent, navigator.vendor || '')
  const browserInfo =
	parseBrowserFromUserAgentData(navigator.userAgentData, highEntropyValues) ||
	parseBrowserFromUserAgent(userAgent)

  return {
    hardware_brand: normalizeValue(hardwareBrand),
    hardware_model: normalizeValue(hardwareModel),
    os_name: normalizeValue(osInfo.name),
    os_version: normalizeValue(osInfo.version),
    software_brand: getSoftwareBrand(browserInfo.name),
    software_version: getSoftwareVersion(browserInfo.version)
  }
}

export const useProcessDeviceStore = defineStore('processDevice', () => {
  const router = useRouter()
  const cameraStore = useCameraStore()
  const apiStore = useApiStore()
  const processApi = useEventyayApi()

  const message = ref('')
  const showSuccess = ref(false)
  const showError = ref(false)

  function $reset() {
    message.value = ''
    showSuccess.value = false
    showError.value = false
  }

  const response = computed(() => {
    let classType = ''
    if (showSuccess.value) {
      classType = 'text-success'
    }
    if (showError.value) {
      classType = 'text-danger'
    }
    return {
      message: message.value,
      class: classType
    }
  })

  function showErrorMsg() {
    showSuccess.value = false
    showError.value = true
  }

  function showSuccessMsg() {
    showSuccess.value = true
    showError.value = false
  }

  async function authDevice() {
    try {
      const qrData = JSON.parse(cameraStore.qrCodeValue)
      if (qrData.handshake_version > 1) {
        message.value = 'Unsupported handshake version'
        showErrorMsg()
        return
      }

	  const deviceInfo = await getDeviceMetadata()

      const payload = {
        token: qrData.token,
		...deviceInfo
      }
      let url = qrData.url
      const api = mande(url, { headers: { 'Content-Type': 'application/json' } })
      const response = await api.post('/api/v1/device/initialize', payload)
      if (response) {
        apiStore.newSession(true)
        const data = response
        showSuccessMsg()
        processApi.setApiCred(data.api_token, url, data.organizer)
        router.push({ name: 'eventyayevents' })
      } else {
        showErrorMsg()
      }
    } catch (error) {
      showErrorMsg()
    }
  }

  return {
    response,
    $reset,
    authDevice
  }
})

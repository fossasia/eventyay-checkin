import { createAuthorizedDeviceApi } from '@/utils/serverUrl'
import { isDeviceAuthFailure } from '@/utils/deviceErrors'

const EVENTYAY_LOGO_URL = '/eventyay-logo.svg'
const EVENTYAY_ICON_URL = '/eventyay-icon.svg'

const AUTO_PRINT_KEY = 'eventyay-checkin-auto-print'

const ROLE_ROUTE_MAP = {
  Exhibitor: 'eventyayleedlogin',
  CheckIn: 'eventyaycheckin',
  'Badge Station': 'eventyaycheckin'
}

const ROLE_LABELS = {
  Exhibitor: 'Lead Scanner',
  CheckIn: 'Check-In Staff',
  'Badge Station': 'Badge Station'
}

export const STATION_TYPE_DEFINITIONS = [
  {
    id: 'Exhibitor',
    title: 'Lead Scanner',
    description:
      'Capture exhibitor leads by scanning attendee badges. Register this device with Full device access in the organizer dashboard.'
  },
  {
    id: 'CheckIn',
    title: 'Check-In Staff',
    description: 'Scan tickets, search attendees, edit details, live registration, and badge printing.'
  },
  {
    id: 'Badge Station',
    title: 'Badge Station',
    description: 'Kiosk fast check-in and badge printing station. Set up kiosk mode before registering.'
  }
]

export function getServerDisplayFromUrl(serverUrl) {
  if (!serverUrl) {
    return ''
  }

  try {
    return new URL(serverUrl).host
  } catch {
    return String(serverUrl).replace(/^https?:\/\//, '').replace(/\/+$/, '')
  }
}

export function getAutoPrintPreference(role) {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTO_PRINT_KEY) || '{}')
    if (typeof stored[role] === 'boolean') {
      return stored[role]
    }
  } catch {
    // Ignore malformed storage
  }
  return role === 'Badge Station'
}

export function setAutoPrintPreference(role, enabled) {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTO_PRINT_KEY) || '{}')
    stored[role] = enabled
    localStorage.setItem(AUTO_PRINT_KEY, JSON.stringify(stored))
  } catch {
    localStorage.setItem(AUTO_PRINT_KEY, JSON.stringify({ [role]: enabled }))
  }
}

export async function validateDeviceSession(processApi) {
  if (!processApi.apitoken || !processApi.url) {
    return false
  }

  try {
    const api = createAuthorizedDeviceApi(processApi.url, processApi.apitoken)
    await api.get('/api/v1/device/session')
    return true
  } catch (error) {
    return !isDeviceAuthFailure(error)
  }
}

export function getRoleRouteName(role) {
  return ROLE_ROUTE_MAP[role] || null
}

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || role
}

export function getEventyayLogoProps(variant = 'full', className = '') {
  return {
    src: variant === 'icon' ? EVENTYAY_ICON_URL : EVENTYAY_LOGO_URL,
    alt: 'Eventyay',
    class: ['block rounded-md', className].filter(Boolean).join(' ')
  }
}

export function parseQrPayload(rawValue, field) {
  const trimmedValue = String(rawValue || '').trim()
  if (!trimmedValue) {
    return ''
  }

  try {
    const parsedValue = JSON.parse(trimmedValue)
    return parsedValue?.[field] || trimmedValue
  } catch {
    return trimmedValue
  }
}

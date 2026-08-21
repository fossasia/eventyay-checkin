import { useEventyayApi } from '@/stores/eventyayapi'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * Pure JavaScript SHA-256 fallback for non-secure HTTP contexts (e.g. LAN IPs without HTTPS).
 */
export function sha256Fallback(str) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount))
  }

  const mathPow = Math.pow
  const maxWord = mathPow(2, 32)
  const lengthProperty = 'length'
  let i, j
  let result = ''

  const words = []
  const asciiBitLength = str[lengthProperty] * 8

  const hash = []
  const k = []
  let primeCounter = 0

  const isComposite = {}
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0
    }
  }

  str += '\x80'
  while ((str[lengthProperty] % 64) - 56) str += '\x00'
  for (i = 0; i < str[lengthProperty]; i++) {
    j = str.charCodeAt(i)
    if (j >> 8) return ''
    words[i >> 2] |= j << ((3 - (i % 4)) * 8)
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0
  words[words[lengthProperty]] = asciiBitLength

  for (j = 0; j < words[lengthProperty];) {
    const w = words.slice(j, (j += 16))
    const oldHash = [...hash]

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2]
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10)
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0

      const s1h = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6])
      const temp1 = (hash[7] + s1h + ch + k[i] + w[i]) | 0

      const s0h = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2])
      const temp2 = (s0h + maj) | 0

      hash[7] = hash[6]
      hash[6] = hash[5]
      hash[5] = hash[4]
      hash[4] = (hash[3] + temp1) | 0
      hash[3] = hash[2]
      hash[2] = hash[1]
      hash[1] = hash[0]
      hash[0] = (temp1 + temp2) | 0
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0
    }
  }

  for (i = 0; i < 8; i++) {
    for (let b = 3; b >= 0; b--) {
      const byte = (hash[i] >>> (b * 8)) & 255
      result += (byte < 16 ? '0' : '') + byte.toString(16)
    }
  }
  return result
}

export async function hashPin(pin, salt) {
  const combined = `${salt}:${pin}`
  try {
    if (typeof crypto !== 'undefined' && crypto?.subtle?.digest) {
      const encoder = new TextEncoder()
      const data = encoder.encode(combined)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // Fall back to pure JS SHA-256
  }
  return sha256Fallback(combined)
}

export function generateSalt(length = 16) {
  try {
    if (typeof crypto !== 'undefined' && crypto?.getRandomValues) {
      const array = new Uint8Array(length)
      crypto.getRandomValues(array)
      return Array.from(array)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    // Fall back to pseudo-random
  }

  let result = ''
  for (let i = 0; i < length; i++) {
    const byte = Math.floor(Math.random() * 256)
    result += byte.toString(16).padStart(2, '0')
  }
  return result
}

export const DEFAULT_LOCKED_ACTIONS = {
  liveRegistration: true,
  attendeeEdit: true,
  badgeLayout: true,
  badgeCustomize: false,
  search: false,
  manualOverride: false,
  signOut: false
}

export function getLockoutDurationSeconds(attempts) {
  if (attempts < 3) {
    return 0
  }
  if (attempts === 3) {
    return 10
  }
  if (attempts === 4) {
    return 30
  }
  return 120 // Max 2 minutes
}

export const useStationLockStore = defineStore(
  'stationLock',
  () => {
    const isEnabled = ref(false)
    const isLocked = ref(false)
    const pinLength = ref(4)
    const pinHash = ref('')
    const pinSalt = ref('')
    const autoLockOnLaunch = ref(true)
    const lockedDisplayMode = ref('badge') // 'badge' | 'hide' | 'disable'
    const failedAttempts = ref(0)
    const lockoutUntil = ref(0)
    const lockedActions = ref({ ...DEFAULT_LOCKED_ACTIONS })

    const isLockoutActive = computed(() => {
      return lockoutUntil.value > Date.now()
    })

    const remainingLockoutSeconds = computed(() => {
      if (!isLockoutActive.value) {
        return 0
      }
      return Math.max(0, Math.ceil((lockoutUntil.value - Date.now()) / 1000))
    })

    function isActionLocked(actionName) {
      if (!isEnabled.value || !isLocked.value) {
        return false
      }
      if (actionName === 'configure') {
        return true
      }
      return Boolean(lockedActions.value[actionName])
    }

    async function setPin(pin, options = {}) {
      const cleanPin = String(pin || '').trim()
      if (!/^\d{4,6}$/.test(cleanPin)) {
        throw new Error('PIN must be 4 to 6 numeric digits')
      }
      const salt = generateSalt()
      const hash = await hashPin(cleanPin, salt)

      pinLength.value = cleanPin.length
      pinSalt.value = salt
      pinHash.value = hash
      isEnabled.value = true
      isLocked.value = true
      failedAttempts.value = 0
      lockoutUntil.value = 0

      if (options.lockedActions) {
        lockedActions.value = {
          ...DEFAULT_LOCKED_ACTIONS,
          ...options.lockedActions
        }
      }
      if (typeof options.autoLockOnLaunch === 'boolean') {
        autoLockOnLaunch.value = options.autoLockOnLaunch
      }
      if (options.lockedDisplayMode) {
        lockedDisplayMode.value = options.lockedDisplayMode
      }
    }

    function removePin() {
      isEnabled.value = false
      isLocked.value = false
      pinLength.value = 4
      pinHash.value = ''
      pinSalt.value = ''
      failedAttempts.value = 0
      lockoutUntil.value = 0
      lockedActions.value = { ...DEFAULT_LOCKED_ACTIONS }
      autoLockOnLaunch.value = true
      lockedDisplayMode.value = 'badge'
    }

    async function verifyPin(pin) {
      if (!isEnabled.value || !pinHash.value || !pinSalt.value) {
        return { success: false, error: 'not_configured' }
      }

      if (isLockoutActive.value) {
        return {
          success: false,
          error: 'locked_out',
          remainingSeconds: remainingLockoutSeconds.value
        }
      }

      const cleanPin = String(pin || '').trim()
      const hash = await hashPin(cleanPin, pinSalt.value)

      if (hash === pinHash.value) {
        failedAttempts.value = 0
        lockoutUntil.value = 0
        isLocked.value = false
        return { success: true }
      }

      failedAttempts.value += 1
      const duration = getLockoutDurationSeconds(failedAttempts.value)
      if (duration > 0) {
        lockoutUntil.value = Date.now() + duration * 1000
      }

      return {
        success: false,
        error: 'incorrect_pin',
        failedAttempts: failedAttempts.value,
        lockoutSeconds: duration,
        remainingSeconds: duration
      }
    }

    async function unlockWithSetupToken(token) {
      const processApi = useEventyayApi()
      const result = await processApi.verifySetupToken(token)

      if (result.success) {
        failedAttempts.value = 0
        lockoutUntil.value = 0
        isLocked.value = false
        return { success: true, requiresPinReset: true }
      }

      return result
    }

    function lock() {
      if (isEnabled.value) {
        isLocked.value = true
      }
    }

    function unlockManual() {
      isLocked.value = false
    }

    function syncLaunchLockState() {
      if (isEnabled.value && autoLockOnLaunch.value) {
        isLocked.value = true
      }
    }

    function $reset() {
      removePin()
    }

    return {
      isEnabled,
      isLocked,
      pinLength,
      pinHash,
      pinSalt,
      autoLockOnLaunch,
      lockedDisplayMode,
      failedAttempts,
      lockoutUntil,
      lockedActions,
      isLockoutActive,
      remainingLockoutSeconds,
      isActionLocked,
      setPin,
      removePin,
      verifyPin,
      unlockWithSetupToken,
      lock,
      unlockManual,
      syncLaunchLockState,
      $reset
    }
  },
  {
    persist: true
  }
)

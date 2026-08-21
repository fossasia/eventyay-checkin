import { useEventyayApi } from '@/stores/eventyayapi'
import {
  generateSalt,
  getLockoutDurationSeconds,
  hashPin,
  sha256Fallback,
  useStationLockStore
} from '@/stores/stationLock'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('stationLock store & crypto utilities', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('generates random hex salt and hashes PIN via SHA-256 correctly', async () => {
    const salt = generateSalt(16)
    expect(salt).toHaveLength(32) // 16 bytes = 32 hex chars

    const hash1 = await hashPin('1234', salt)
    const hash2 = await hashPin('1234', salt)
    const hash3 = await hashPin('5678', salt)

    expect(hash1).toBe(hash2)
    expect(hash1).not.toBe(hash3)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  it('computes exact SHA-256 in fallback mode', async () => {
    const input = 'a1b2c3d4e5f6:1234'
    const fallbackHash = sha256Fallback(input)
    const subtleHash = await hashPin('1234', 'a1b2c3d4e5f6')

    expect(fallbackHash).toBe(subtleHash)
    expect(fallbackHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('calculates progressive lockout durations', () => {
    expect(getLockoutDurationSeconds(0)).toBe(0)
    expect(getLockoutDurationSeconds(1)).toBe(0)
    expect(getLockoutDurationSeconds(2)).toBe(0)
    expect(getLockoutDurationSeconds(3)).toBe(10)
    expect(getLockoutDurationSeconds(4)).toBe(30)
    expect(getLockoutDurationSeconds(5)).toBe(120)
    expect(getLockoutDurationSeconds(10)).toBe(120)
  })

  it('sets and removes PIN with validation', async () => {
    const store = useStationLockStore()
    expect(store.isEnabled).toBe(false)
    expect(store.isLocked).toBe(false)

    await expect(store.setPin('12')).rejects.toThrow('PIN must be 4 to 6 numeric digits')
    await expect(store.setPin('abcd')).rejects.toThrow('PIN must be 4 to 6 numeric digits')

    await store.setPin('1234', {
      autoLockOnLaunch: true,
      lockedDisplayMode: 'hide',
      lockedActions: {
        liveRegistration: true,
        attendeeEdit: false
      }
    })

    expect(store.isEnabled).toBe(true)
    expect(store.isLocked).toBe(true)
    expect(store.autoLockOnLaunch).toBe(true)
    expect(store.lockedDisplayMode).toBe('hide')
    expect(store.lockedActions.liveRegistration).toBe(true)
    expect(store.lockedActions.attendeeEdit).toBe(false)

    store.removePin()
    expect(store.isEnabled).toBe(false)
    expect(store.isLocked).toBe(false)
    expect(store.pinHash).toBe('')
    expect(store.pinSalt).toBe('')
  })

  it('verifies correct PIN and unlocks the station', async () => {
    const store = useStationLockStore()
    await store.setPin('9876')
    expect(store.isLocked).toBe(true)

    const result = await store.verifyPin('9876')
    expect(result.success).toBe(true)
    expect(store.isLocked).toBe(false)
    expect(store.failedAttempts).toBe(0)
  })

  it('handles incorrect PIN attempts with progressive lockout', async () => {
    const store = useStationLockStore()
    await store.setPin('4321')

    // 1st attempt
    let res = await store.verifyPin('0000')
    expect(res.success).toBe(false)
    expect(res.error).toBe('incorrect_pin')
    expect(res.failedAttempts).toBe(1)
    expect(res.lockoutSeconds).toBe(0)
    expect(store.isLocked).toBe(true)

    // 2nd attempt
    res = await store.verifyPin('0000')
    expect(res.failedAttempts).toBe(2)
    expect(res.lockoutSeconds).toBe(0)

    // 3rd attempt -> 10s lockout
    res = await store.verifyPin('0000')
    expect(res.failedAttempts).toBe(3)
    expect(res.lockoutSeconds).toBe(10)
    expect(store.isLockoutActive).toBe(true)
    expect(store.remainingLockoutSeconds).toBeGreaterThanOrEqual(9)

    // Attempting while locked out returns locked_out error
    res = await store.verifyPin('4321')
    expect(res.success).toBe(false)
    expect(res.error).toBe('locked_out')
  })

  it('unsubscribes / resets lockout with setup token master override', async () => {
    const store = useStationLockStore()
    const processApi = useEventyayApi()
    await store.setPin('1111')

    // Trigger lockout
    store.failedAttempts = 5
    store.lockoutUntil = Date.now() + 120000
    expect(store.isLockoutActive).toBe(true)

    // Mock verifySetupToken
    vi.spyOn(processApi, 'verifySetupToken').mockResolvedValue({ success: true })

    const result = await store.unlockWithSetupToken('VALID-SETUP-TOKEN')
    expect(result.success).toBe(true)
    expect(result.requiresPinReset).toBe(true)
    expect(store.isLocked).toBe(false)
    expect(store.failedAttempts).toBe(0)
    expect(store.lockoutUntil).toBe(0)
    expect(store.isLockoutActive).toBe(false)
  })

  it('correctly checks isActionLocked', async () => {
    const store = useStationLockStore()
    expect(store.isActionLocked('liveRegistration')).toBe(false)

    await store.setPin('1234', {
      lockedActions: {
        liveRegistration: true,
        search: false
      }
    })

    expect(store.isActionLocked('liveRegistration')).toBe(true)
    expect(store.isActionLocked('search')).toBe(false)

    // Unlock station
    store.unlockManual()
    expect(store.isActionLocked('liveRegistration')).toBe(false)

    // Relock station
    store.lock()
    expect(store.isActionLocked('liveRegistration')).toBe(true)
  })
})

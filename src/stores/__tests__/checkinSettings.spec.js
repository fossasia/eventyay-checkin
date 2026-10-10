import { useCheckinSettingsStore } from '@/stores/checkinSettings'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'eventyay-checkin-auto-print'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('auto-print settings', () => {
  it.each(['SecurityError', 'QuotaExceededError'])(
    'applies the setting to the current station when storage throws %s',
    (name) => {
      const store = useCheckinSettingsStore()
      store.syncAutoPrintForRole('Badge Station')
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Storage unavailable', name)
      })

      expect(() => store.setAutoPrintForRole('Badge Station', false)).not.toThrow()
      expect(store.autoPrintEnabled).toBe(false)
      expect(store.isAutoPrintActive('Badge Station')).toBe(false)
      expect(() => store.setAutoPrintForRole('Badge Station', true)).not.toThrow()
      expect(store.isAutoPrintActive('Badge Station')).toBe(true)
    }
  )

  it('applies the current setting when reading and writing storage are both blocked', () => {
    const store = useCheckinSettingsStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError')
    })

    store.syncAutoPrintForRole('Badge Station')
    expect(store.autoPrintEnabled).toBe(true)
    expect(() => store.setAutoPrintForRole('Badge Station', false)).not.toThrow()
    expect(store.autoPrintEnabled).toBe(false)
  })

  it.each(['[]', 'null', '"invalid"', '{invalid'])(
    'replaces invalid stored preferences (%s) with a usable role preference',
    (saved) => {
      localStorage.setItem(STORAGE_KEY, saved)
      const store = useCheckinSettingsStore()
      store.setAutoPrintForRole('Badge Station', false)

      const reloaded = useCheckinSettingsStore(createPinia())
      reloaded.syncAutoPrintForRole('Badge Station')
      expect(reloaded.autoPrintEnabled).toBe(false)
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ 'Badge Station': false })
    }
  )

  it('preserves other roles and reloads a successfully saved setting', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ CheckIn: true }))
    const store = useCheckinSettingsStore()
    store.setAutoPrintForRole('Badge Station', false)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({
      CheckIn: true,
      'Badge Station': false
    })
    const reloaded = useCheckinSettingsStore(createPinia())
    reloaded.syncAutoPrintForRole('Badge Station')
    expect(reloaded.isAutoPrintActive('Badge Station')).toBe(false)
    reloaded.syncAutoPrintForRole('CheckIn')
    expect(reloaded.autoPrintEnabled).toBe(true)
    expect(reloaded.isAutoPrintActive('CheckIn')).toBe(false)
  })
})

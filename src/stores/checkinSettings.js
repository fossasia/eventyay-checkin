import { getAutoPrintPreference, setAutoPrintPreference } from '@/utils/session'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCheckinSettingsStore = defineStore('checkinSettings', () => {
  const autoPrintEnabled = ref(true)
  const unsavedPreferences = new Map()

  function syncAutoPrintForRole(role) {
    autoPrintEnabled.value = unsavedPreferences.has(role)
      ? unsavedPreferences.get(role)
      : getAutoPrintPreference(role)
  }

  function setAutoPrintForRole(role, enabled) {
    if (setAutoPrintPreference(role, enabled)) {
      unsavedPreferences.delete(role)
    } else {
      unsavedPreferences.set(role, enabled)
    }
    autoPrintEnabled.value = enabled
  }

  function isAutoPrintActive(role) {
    return role === 'Badge Station' && autoPrintEnabled.value
  }

  return {
    autoPrintEnabled,
    syncAutoPrintForRole,
    setAutoPrintForRole,
    isAutoPrintActive
  }
})

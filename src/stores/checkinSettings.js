import { getAutoPrintPreference, setAutoPrintPreference } from '@/utils/session'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCheckinSettingsStore = defineStore('checkinSettings', () => {
  const autoPrintEnabled = ref(true)

  function syncAutoPrintForRole(role) {
    autoPrintEnabled.value = getAutoPrintPreference(role)
  }

  function setAutoPrintForRole(role, enabled) {
    setAutoPrintPreference(role, enabled)
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

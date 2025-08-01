import { ref, computed } from 'vue'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'

/**
 * Composable for managing check-in modal state and countdown functionality
 */
export function useCheckInModal() {
  const store = useProcessEventyayCheckInStore()
  
  // Modal state
  const showModal = ref(false)
  const countdown = ref(5)
  const notes = ref('')
  const isTimerActive = ref(false)
  let timer = null

  // Computed properties
  const isCheckoutMode = computed(() => store.isCheckoutMode)
  const showSuccess = computed(() => store.showSuccess)
  const showError = computed(() => store.showError)
  const message = computed(() => store.message)
  const badgeUrl = computed(() => store.badgeUrl)

  /**
   * Starts the countdown timer
   */
  const startTimer = () => {
    if (timer) clearInterval(timer)
    
    countdown.value = 5
    isTimerActive.value = true
    
    timer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) {
        stopTimer()
        closeModal()
      }
    }, 1000)
  }

  /**
   * Stops the countdown timer
   */
  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    isTimerActive.value = false
  }

  /**
   * Opens the modal and starts countdown if success/error message exists
   */
  const openModal = () => {
    showModal.value = true
    if (showSuccess.value || showError.value) {
      startTimer()
    }
  }

  /**
   * Closes the modal and resets state
   */
  const closeModal = () => {
    stopTimer()
    showModal.value = false
    notes.value = ''
    countdown.value = 5
    store.resetMessages()
  }

  /**
   * Handles notes input and stops timer
   */
  const handleNotesInput = () => {
    stopTimer()
    countdown.value = 0
  }

  /**
   * Processes check-in/check-out with the provided data
   */
  const processCheckIn = async (qrData) => {
    try {
      await store.checkIn(qrData, notes.value)
      openModal()
    } catch (error) {
      console.error('Check-in process failed:', error)
    }
  }

  /**
   * Toggles between check-in and check-out modes
   */
  const toggleMode = () => {
    store.toggleMode()
  }

  /**
   * Downloads badge if available
   */
  const downloadBadge = () => {
    if (badgeUrl.value) {
      window.open(badgeUrl.value, '_blank')
    }
  }

  return {
    // State
    showModal,
    countdown,
    notes,
    isTimerActive,
    
    // Computed
    isCheckoutMode,
    showSuccess,
    showError,
    message,
    badgeUrl,
    
    // Methods
    startTimer,
    stopTimer,
    openModal,
    closeModal,
    handleNotesInput,
    processCheckIn,
    toggleMode,
    downloadBadge
  }
}

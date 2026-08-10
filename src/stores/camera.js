import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCameraStore = defineStore('camera', () => {
  const selectedCameraId = ref({
    deviceId: 'environment'
  })
  const cameraDevices = ref([])
  const paused = ref(false)
  const qrCodeValue = ref(null)
  const isProcessing = ref(false)

  function $reset() {
    selectedCameraId.value = {
      deviceId: 'environment'
    }
    paused.value = false
    cameraDevices.value = []
    qrCodeValue.value = null
    isProcessing.value = false
  }

  function clearLastScan() {
    qrCodeValue.value = null
    isProcessing.value = false
  }

  function toggleCameraSide() {
    const qty = cameraDevices.value.length
    if (qty <= 1) {
      return false
    }

    const currentId = selectedCameraId.value.deviceId
    if (currentId === 'environment' || currentId === 'user') {
      selectedCameraId.value = {
        deviceId: cameraDevices.value[0].id
      }
      return true
    }

    const index = cameraDevices.value.findIndex((device) => device.id === currentId)
    const currentIndex = index >= 0 ? index : 0
    const nextIndex = (currentIndex + 1) % qty
    selectedCameraId.value = {
      deviceId: cameraDevices.value[nextIndex].id
    }
    return true
  }

  function logErrors(error) {
    console.error(error)
    if (error.name === 'NotAllowedError') {
      console.error('You need to grant this page permission to access your camera.')
    }
  }

  return {
    selectedCameraId,
    paused,
    cameraDevices,
    qrCodeValue,
    isProcessing,
    $reset,
    clearLastScan,
    toggleCameraSide,
    logErrors
  }
})

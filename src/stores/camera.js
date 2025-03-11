import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCameraStore = defineStore('camera', () => {
  const selectedCameraId = ref({
    deviceId: 'environment'
  })
  const cameraDevices = ref([])
  const paused = ref(false)
  const qrCodeValue = ref(null)

  function $reset() {
    selectedCameraId.value = {
      deviceId: 'environment'
    }
    paused.value = false
    cameraDevices.value = []
    qrCodeValue.value = null
  }

  function toggleCameraSide() {
    if (cameraDevices.value.length < 2) return

    let currentIndex = cameraDevices.value.findIndex(device => 
      device.id === selectedCameraId.value.deviceId
    )

    // Select the next camera in the list (loop back if at the end)
    const nextIndex = (currentIndex + 1) % cameraDevices.value.length
    selectedCameraId.value.deviceId = cameraDevices.value[nextIndex].id

    // Stop the current camera stream before switching
    stopCameraStream()

    // Restart camera after a short delay
    setTimeout(() => {
      startCameraStream()
    }, 500) // Ensures proper switching
  }

  function stopCameraStream() {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        stream.getTracks().forEach(track => track.stop()) // Stop all video tracks
      })
      .catch(err => console.error("Error stopping camera:", err))
  }

  function startCameraStream() {
    paused.value = true
    setTimeout(() => {
      paused.value = false
    }, 300) // Ensures Vue updates the state properly
  }

  function paintOutline(detectedCodes, ctx) {
    for (const detectedCode of detectedCodes) {
      qrCodeValue.value = detectedCode.rawValue
      const [firstPoint, ...otherPoints] = detectedCode.cornerPoints
      ctx.strokeStyle = 'red'
      ctx.strokeWidth = 5

      ctx.beginPath()
      ctx.moveTo(firstPoint.x, firstPoint.y)
      for (const { x, y } of otherPoints) {
        ctx.lineTo(x, y)
      }
      ctx.lineTo(firstPoint.x, firstPoint.y)
      ctx.closePath()
      ctx.stroke()
    }
  }

  const selected = {
    text: 'outline',
    value: paintOutline
  }

  function logErrors(error) {
    console.error(error)
    if (error.name === 'NotAllowedError') {
      console.error('You need to grant this page permission to access your camera and microphone.')
    }
  }

  return {
    selectedCameraId,
    paused,
    cameraDevices,
    qrCodeValue,
    $reset,
    toggleCameraSide,
    selected,
    logErrors,
    stopCameraStream,
    startCameraStream
  }
})

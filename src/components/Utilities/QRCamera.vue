<script setup>
import { onBeforeMount, ref, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { QrcodeStream } from 'vue-qrcode-reader'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useCameraStore } from '@/stores/camera'
import { useEventyayApi } from '@/stores/eventyayapi'
import RefreshButton from '@/components/Utilities/RefreshButton.vue'
import { ArrowsRightLeftIcon, VideoCameraIcon } from '@heroicons/vue/20/solid'

const cameraStore = useCameraStore()

const emit = defineEmits(['scanned'])
const destroyed = ref(false)
const isCameraOn = ref(false)
const cameraStreamNonce = ref(0)
let inactivityTimer = null

const processApi = useEventyayApi()
const { selectedRole } = processApi

onMounted(() => {
  if (selectedRole !== 'Badge Station') {
    startInactivityTimer()
  }
})

onUnmounted(() => {
  clearInactivityTimer()
})

// get list of camera devices of device and side
// safari problems: always ask
onBeforeMount(() => { updateAvailableCamera() })

const cameraConstraints = computed(() => {
  const currentDeviceId = cameraStore.selectedCameraId?.deviceId
  if (!currentDeviceId || currentDeviceId === 'environment') {
    return {
      facingMode: 'environment'
    }
  }
  if (currentDeviceId === 'user') {
    return {
      facingMode: 'user'
    }
  }
  return {
    deviceId: {
      exact: currentDeviceId
    }
  }
})

const cameraStreamKey = computed(() => {
  return `${cameraStreamNonce.value}-${cameraConstraints.value.deviceId}`
})

async function updateAvailableCamera() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return
  }

  try {
    const currentSelectedId = cameraStore.selectedCameraId?.deviceId
    const devices = await navigator.mediaDevices.enumerateDevices()
    const environmentCameras = []
    const videoDevices = []

    devices.forEach((device) => {
      if (device.kind !== 'videoinput') {
        return
      }

      const camera = {
        id: device.deviceId
      }
      const normalizedLabel = device.label ? device.label.toLowerCase() : ''
      if (
        normalizedLabel.includes('back') ||
        normalizedLabel.includes('rear') ||
        normalizedLabel.includes('environment')
      ) {
        camera.facing = 'environment'
        environmentCameras.push(camera)
      }
      videoDevices.push(camera)
    })

    cameraStore.cameraDevices = videoDevices

    if (videoDevices.length === 0) {
      cameraStore.selectedCameraId = {
        deviceId: 'environment'
      }
      return
    }

    const hasCurrentDevice = videoDevices.some((camera) => camera.id === currentSelectedId)
    if (hasCurrentDevice) {
      cameraStore.selectedCameraId = {
        deviceId: currentSelectedId
      }
      return
    }

    // select last environment camera when available, else fallback to the first camera
    const preferredCamera =
      environmentCameras.length > 0
        ? environmentCameras[environmentCameras.length - 1]
        : videoDevices[0]

    cameraStore.selectedCameraId = {
      deviceId: preferredCamera.id || 'environment'
    }
  } catch (err) {
    console.log(err.name + ': ' + err.message)
  }
}

async function detectedQR([result]) {
  if (result) {
    // check if previous data is same
    if (cameraStore.qrCodeValue === result.rawValue) {
      return
    }
    cameraStore.qrCodeValue = result.rawValue
    emit('scanned')
  }
}

async function switchCamera() {
  await updateAvailableCamera()

  const hasSwitchedCamera = cameraStore.toggleCameraSide()
  if (!isCameraOn.value || !hasSwitchedCamera) {
    startInactivityTimer()
    return
  }

  destroyed.value = true
  await nextTick()
  cameraStreamNonce.value += 1
  destroyed.value = false
  startInactivityTimer()
}

function toggleCamera() {
  isCameraOn.value = !isCameraOn.value
  cameraStore.paused = !isCameraOn.value
  startInactivityTimer()
}

function startInactivityTimer() {
  clearInactivityTimer()
  if (selectedRole !== 'Badge Station') {
    inactivityTimer = setTimeout(() => {
      isCameraOn.value = false
      cameraStore.paused = true
    }, 25000) // 25 seconds
  }
}

function clearInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer)
    inactivityTimer = null
  }
}
</script>

<template>
  <qrcode-stream
    v-if="!destroyed && isCameraOn"
    :key="cameraStreamKey"
    class="!aspect-square !h-auto max-w-sm"
    :paused="cameraStore.paused"
    :track="cameraStore.selected.value"
    :constraints="cameraConstraints"
    @error="cameraStore.logErrors"
    @detect="detectedQR"
  />
  <div class="space-x-3">
    <StandardButton
      :text="isCameraOn ? 'Turn Camera Off' : 'Turn Camera On'"
      :icon="isCameraOn ? VideoCameraIcon : VideoCameraIcon"
      class="mt-4 bg-primary"
      @click="toggleCamera"
    />
    <StandardButton
      :text="'Switch Camera'"
      :icon="ArrowsRightLeftIcon"
      class="mt-4 bg-primary"
      @click="switchCamera"
    />
    <RefreshButton class="mt-4" />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, nextTick, computed, watch } from 'vue'
import { QrcodeStream } from 'vue-qrcode-reader'
import { ArrowsRightLeftIcon, VideoCameraIcon } from '@heroicons/vue/20/solid'
import StandardButton from '@/components/Common/StandardButton.vue'
import RefreshButton from '@/components/Utilities/RefreshButton.vue'
import { useCameraStore } from '@/stores/camera'
import { paintQrScannerTrack } from '@/utils/qrScannerTrack'

const emit = defineEmits(['scanned'])

const cameraStore = useCameraStore()
const destroyed = ref(false)
const isCameraOn = ref(false)
const hasDetection = ref(false)
const cameraStreamNonce = ref(0)

const scanFormats = ['qr_code']

const cameraConstraints = computed(() => {
  const currentDeviceId = cameraStore.selectedCameraId?.deviceId
  const video = {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 }
  }

  if (currentDeviceId === 'user') {
    return { ...video, facingMode: 'user' }
  }
  if (!currentDeviceId || currentDeviceId === 'environment') {
    return { ...video, facingMode: 'environment' }
  }
  return { ...video, deviceId: { exact: currentDeviceId } }
})

const cameraStreamKey = computed(() => {
  const id = cameraStore.selectedCameraId?.deviceId || 'environment'
  return `${cameraStreamNonce.value}-${id}`
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

      const camera = { id: device.deviceId }
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
      cameraStore.selectedCameraId = { deviceId: 'environment' }
      return
    }

    const usesFacingMode =
      !currentSelectedId || currentSelectedId === 'environment' || currentSelectedId === 'user'
    if (usesFacingMode) {
      return
    }

    const hasCurrentDevice = videoDevices.some((camera) => camera.id === currentSelectedId)
    if (hasCurrentDevice) {
      return
    }

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

function detectedQR(detectedCodes) {
  const result = detectedCodes?.[0]
  hasDetection.value = Boolean(result)

  if (!result || cameraStore.isProcessing || cameraStore.paused) {
    return
  }

  if (cameraStore.qrCodeValue === result.rawValue) {
    return
  }

  cameraStore.qrCodeValue = result.rawValue
  cameraStore.isProcessing = true
  emit('scanned')
}

async function switchCamera() {
  await updateAvailableCamera()

  const hasSwitchedCamera = cameraStore.toggleCameraSide()
  if (!isCameraOn.value || !hasSwitchedCamera) {
    return
  }

  destroyed.value = true
  await nextTick()
  cameraStreamNonce.value += 1
  destroyed.value = false
}

function toggleCamera() {
  isCameraOn.value = !isCameraOn.value
  cameraStore.paused = !isCameraOn.value
  if (isCameraOn.value) {
    cameraStore.clearLastScan()
    hasDetection.value = false
  }
}

async function refreshCamera() {
  cameraStore.clearLastScan()
  hasDetection.value = false

  await updateAvailableCamera()

  if (!isCameraOn.value) {
    isCameraOn.value = true
    cameraStore.paused = false
  }

  destroyed.value = true
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 350))
  cameraStreamNonce.value += 1
  destroyed.value = false
}

watch(
  () => cameraStore.isProcessing,
  (processing) => {
    if (!processing) {
      hasDetection.value = false
    }
  }
)

onMounted(async () => {
  cameraStore.paused = false
  await updateAvailableCamera()
  isCameraOn.value = true
})

onUnmounted(() => {
  isCameraOn.value = false
  cameraStore.paused = true
})
</script>

<template>
  <div class="flex flex-col items-center">
    <div class="relative w-full max-w-sm overflow-hidden rounded-xl border border-surface-border bg-black">
      <qrcode-stream
        v-if="!destroyed && isCameraOn"
        :key="cameraStreamKey"
        class="scanner-stream !aspect-square !h-auto w-full"
        :paused="cameraStore.paused || cameraStore.isProcessing"
        :formats="scanFormats"
        :track="paintQrScannerTrack"
        :constraints="cameraConstraints"
        @error="cameraStore.logErrors"
        @detect="detectedQR"
      />

      <div
        v-else
        class="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-surface-muted px-6 py-8 text-center"
      >
        <VideoCameraIcon class="h-8 w-8 text-body-muted" aria-hidden="true" />
        <div>
          <p class="text-sm font-medium text-body">Camera is off</p>
          <p class="mt-1 text-xs leading-relaxed text-body-muted">
            Turn on the camera to scan QR codes for check-in and registration.
          </p>
        </div>
      </div>

      <div
        v-if="isCameraOn"
        class="scanner-viewfinder pointer-events-none absolute inset-6 overflow-hidden rounded-xl border-2 border-white/70"
      >
        <div v-if="!hasDetection" class="scanner-line" aria-hidden="true" />
      </div>
    </div>

    <div class="mt-4 flex flex-wrap justify-center gap-2">
      <StandardButton
        :text="isCameraOn ? 'Turn off' : 'Turn on'"
        :icon="VideoCameraIcon"
        variant="primary"
        size="sm"
        @click="toggleCamera"
      />
      <StandardButton
        text="Switch"
        :icon="ArrowsRightLeftIcon"
        variant="white"
        size="sm"
        @click="switchCamera"
      />
      <RefreshButton @refresh="refreshCamera" />
    </div>
  </div>
</template>

<style scoped>
.scanner-stream {
  transform: scaleX(-1);
}

.scanner-stream :deep(video) {
  object-fit: cover;
}

.scanner-line {
  position: absolute;
  left: 10%;
  right: 10%;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.95), transparent);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.45);
  animation: scanner-sweep 2.4s ease-in-out infinite;
}

@keyframes scanner-sweep {
  0%,
  100% {
    top: 10%;
    opacity: 0.5;
  }
  50% {
    top: 90%;
    opacity: 1;
  }
}
</style>

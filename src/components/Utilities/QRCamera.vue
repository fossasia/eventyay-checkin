<script setup>
import { onBeforeMount, ref, nextTick, onMounted, onUnmounted } from 'vue'
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
let inactivityTimer = null

const processApi = useEventyayApi()
const { selectedRole } = processApi

onMounted(() => {
  if (selectedRole!="Badge Station") {startInactivityTimer()}
})

onUnmounted(() => {
  clearInactivityTimer()
})

// get list of camera devices of device and side
// safari problems: always ask
onBeforeMount(() => { updateAvailableCamera() })

function updateAvailableCamera() {
  if (navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        let environmentCameras = []
        devices.forEach((device) => {
          if (device.kind === 'videoinput') {
            let obj = {}
            const id = device.deviceId
            obj.id = id
            if (device.label && device.label.length > 0) {
              if (device.label.toLowerCase().indexOf('back') >= 0) {
                obj.facing = 'environment'
                console.log('found back camera')
                environmentCameras.push(obj)
              }
            }
            cameraStore.cameraDevices.push(obj)
          }
        })
        console.log('found cameras:')
        console.log(cameraStore.cameraDevices)
        console.log('found bac cameras:')
        console.log(environmentCameras)

        // select last of environment cameras
        if (environmentCameras.length > 0) {
          cameraStore.selectedCameraId.deviceId =
            environmentCameras[environmentCameras.length - 1].id
        } else {
          console.log(cameraStore.cameraDevices)
          cameraStore.selectedCameraId.deviceId = cameraStore.cameraDevices[0].id
        }
      })
      .catch(function (err) {
        console.log(err.name + ': ' + err.message)
      })
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

function switchCamera() {
  destroyed.value = true
  console.log('switchCamera: having the following cameras:')
  console.log(cameraStore.cameraDevices)
  console.log('switchCamera: cameraDevices.value = ' + cameraStore.cameraDevices.value)
  console.log('camerastore.cameradevices.length = ' + cameraStore.cameraDevices.length)
  // when access is not granted, the cameraStore contains only one entry
  // with an empty id, no more information is provided
  // In this case, since we are here already and access is granted, reload the
  // set of available cameras so that we can switch to the back facing one.
  if (cameraStore.cameraDevices.length === 1 && cameraStore.cameraDevices[0].id === "") {
    console.log("No cameras found in cameraStore, re-enumerating them")
    updateAvailableCamera()
  }
  cameraStore.toggleCameraSide()
  nextTick(() => {
    destroyed.value = false
  })
  startInactivityTimer()
}

function toggleCamera() {
  isCameraOn.value = !isCameraOn.value
  cameraStore.paused = !isCameraOn.value
  startInactivityTimer()
}

function startInactivityTimer() {
  clearInactivityTimer()
  if (selectedRole!="Badge Station") {
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
    class="!aspect-square !h-auto max-w-sm"
    :paused="cameraStore.paused"
    :track="cameraStore.selected.value"
    :constraints="cameraStore.selectedCameraId"
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

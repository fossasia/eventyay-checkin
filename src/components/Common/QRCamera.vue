<script setup>
import QRCamera from '@/components/Utilities/QRCamera.vue'
import { useCameraStore } from '@/stores/camera'
import { useProcessEventyayCheckInStore } from '@/stores/processEventyayCheckIn'
import { useLeadScanStore } from '@/stores/leadscan'

const props = defineProps({
  qrType: {
    type: String,
    required: true
  },
  scanType: {
    type: String,
    default: ''
  },
  details: {
    type: String,
    default: ''
  },
  keepActive: {
    type: Boolean,
    default: false
  }
})

const cameraStore = useCameraStore()
const processEventyayCheckIn = useProcessEventyayCheckInStore()
const processLeadScan = useLeadScanStore()

async function processQR() {
  try {
    if (props.qrType === 'eventyaycheckin') {
      await processEventyayCheckIn.checkIn()
    } else if (props.qrType === 'eventyaylead') {
      await processLeadScan.scanLead()
    }
  } finally {
    if (props.qrType === 'eventyaylead') {
      cameraStore.clearLastScan()
    }
  }
}
</script>

<template>
  <div class="text-center">
    <h3 v-if="scanType" class="mb-3 text-sm font-medium text-body-muted">
      Scan QR · {{ scanType }}
    </h3>
    <p v-if="details" class="mb-3 text-sm text-body-muted">{{ details }}</p>
    <QRCamera :keep-active="keepActive" @scanned="processQR" />
  </div>
</template>

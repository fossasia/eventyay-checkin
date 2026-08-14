<script setup>
import { storeToRefs } from 'pinia'
import { useOfflineSyncStore } from '@/stores/offlineSync'

const offlineSync = useOfflineSyncStore()
const { enabled, statusLabel, isOnline, lastError } = storeToRefs(offlineSync)
</script>

<template>
  <div
    v-if="enabled"
    class="flex items-center gap-2 text-xs text-body-muted"
    :title="lastError || statusLabel"
  >
    <span
      class="inline-flex h-2 w-2 rounded-full"
      :class="isOnline ? 'bg-emerald-500' : 'bg-amber-500'"
      aria-hidden="true"
    />
    <span class="hidden sm:inline">{{ statusLabel }}</span>
  </div>
</template>

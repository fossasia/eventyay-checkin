<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useOfflineSyncStore } from '@/stores/offlineSync'

const offlineSync = useOfflineSyncStore()
const {
  enabled,
  statusLabel,
  isSyncing,
  isOnline,
  lastError,
  syncProgressPercent,
  syncPhase
} = storeToRefs(offlineSync)

const progressWidth = computed(() => `${Math.min(100, Math.max(0, syncProgressPercent.value))}%`)
const progressText = computed(() => `${Math.round(syncProgressPercent.value)}%`)
const showProgress = computed(() => isSyncing.value || syncProgressPercent.value > 0)
</script>

<template>
  <div
    v-if="enabled"
    class="flex min-w-0 items-center gap-2 text-xs text-body-muted"
    :title="lastError || statusLabel"
  >
    <span
      class="inline-flex h-2 w-2 shrink-0 rounded-full"
      :class="isOnline ? 'bg-emerald-500' : 'bg-amber-500'"
      aria-hidden="true"
    />

    <div class="flex min-w-0 flex-col gap-1">
      <span class="truncate leading-none">{{ statusLabel }}</span>
      <div
        v-if="showProgress"
        class="h-1.5 w-28 overflow-hidden rounded-full bg-surface-border"
        role="progressbar"
        :aria-valuenow="Math.round(syncProgressPercent)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`Offline sync ${progressText}`"
        :aria-busy="isSyncing"
      >
        <div
          class="offline-sync-bar h-full rounded-full bg-primary"
          :style="{ width: progressWidth }"
        />
      </div>
    </div>

    <span v-if="showProgress" class="tabular-nums text-body">{{ progressText }}</span>
    <span class="sr-only">{{ syncPhase }}</span>
  </div>
</template>

<style scoped>
.offline-sync-bar {
  transition: width 280ms linear;
  will-change: width;
}
</style>

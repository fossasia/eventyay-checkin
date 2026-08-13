<script setup>
import { ArrowPathIcon } from '@heroicons/vue/20/solid'
import { storeToRefs } from 'pinia'
import { useOfflineSyncStore } from '@/stores/offlineSync'
import { useEventyayApi } from '@/stores/eventyayapi'

const offlineSync = useOfflineSyncStore()
const processApi = useEventyayApi()
const { enabled, statusLabel, isSyncing, isOnline, lastError } = storeToRefs(offlineSync)

async function onSyncClick() {
  await offlineSync.syncNow(processApi)
}
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
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface px-2 py-1 font-medium text-body hover:bg-surface-muted disabled:opacity-60"
      :disabled="isSyncing || !isOnline"
      @click="onSyncClick"
    >
      <ArrowPathIcon class="h-3.5 w-3.5" :class="{ 'animate-spin': isSyncing }" aria-hidden="true" />
      Sync
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useLoadingStore } from '@/stores/loading'
import { getEventyayLogoProps, getRoleLabel } from '@/utils/session'

const route = useRoute()
const router = useRouter()
const processApi = useEventyayApi()
const loadingStore = useLoadingStore()

loadingStore.navbarLoaded()

const isAuthenticated = computed(() => Boolean(processApi.apitoken))
const showBar = computed(() => isAuthenticated.value && route.name !== 'userAuth')
const roleLabel = computed(() => getRoleLabel(processApi.selectedRole))
const eventLabel = computed(() => processApi.eventname || '')
const gateLabel = computed(() => processApi.gateName || '')
const deviceLabel = computed(() => processApi.deviceName || '')

const contextLabel = computed(() => {
  const parts = []
  if (eventLabel.value) {
    parts.push(eventLabel.value)
  }
  if (roleLabel.value) {
    parts.push(roleLabel.value)
  }
  if (gateLabel.value) {
    parts.push(gateLabel.value)
  } else if (deviceLabel.value) {
    parts.push(deviceLabel.value)
  }
  return parts.join(' · ')
})

function logout() {
  processApi.logout()
  router.push({ name: 'userAuth' })
}
</script>

<template>
  <header
    v-if="showBar"
    class="sticky top-0 z-20 border-b border-surface-border bg-surface/95 backdrop-blur-sm"
  >
    <div class="mx-auto flex h-11 max-w-6xl xl:max-w-7xl 2xl:max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <img v-bind="getEventyayLogoProps('icon', 'h-7 w-7 shrink-0')" />
        <p v-if="contextLabel" class="min-w-0 truncate text-sm text-body-muted">
          {{ contextLabel }}
        </p>
      </div>

      <button
        type="button"
        class="shrink-0 text-sm text-body-muted transition hover:text-body"
        @click="logout"
      >
        Sign out
      </button>
    </div>
  </header>
</template>

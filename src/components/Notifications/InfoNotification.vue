<script setup>
import { InformationCircleIcon } from '@heroicons/vue/24/outline'
import NotificationBaseTemplate from '@/components/Notifications/NotificationBaseTemplate.vue'

defineProps({
  messages: {
    type: Array,
    default: () => []
  }
})
</script>

<template>
  <NotificationBaseTemplate>
    <template #icon>
      <InformationCircleIcon class="h-6 w-6 text-primary" aria-hidden="true" />
    </template>
    <template #messages>
      <p v-for="(msg, index) in messages" :key="index" class="text-sm font-medium">{{ msg }}</p>
    </template>
  </NotificationBaseTemplate>
</template>

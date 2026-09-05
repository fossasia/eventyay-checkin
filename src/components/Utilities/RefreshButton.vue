<script setup>
import { ArrowPathIcon } from '@heroicons/vue/20/solid'
import StandardButton from '@/components/Common/StandardButton.vue'

const emit = defineEmits(['refresh'])

function onRefresh() {
  emit('refresh')
}
</script>
<template>
  <StandardButton
    text="Refresh"
    :icon="ArrowPathIcon"
    variant="white"
    size="sm"
    @click="onRefresh"
  />
</template>

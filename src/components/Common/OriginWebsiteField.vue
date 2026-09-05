<script setup>
import { computed } from 'vue'
import {
  CUSTOM_ORIGIN_WEBSITE,
  DEFAULT_ORIGIN_WEBSITE,
  ORIGIN_WEBSITE_OPTIONS
} from '@/utils/originWebsites'

const selected = defineModel('selected', { type: String, default: DEFAULT_ORIGIN_WEBSITE })
const customUrl = defineModel('customUrl', { type: String, default: '' })

const isCustom = computed(() => selected.value === CUSTOM_ORIGIN_WEBSITE)
</script>

<template>
  <div class="space-y-3">
    <div>
      <label for="origin-website" class="block text-xs font-semibold text-body-muted uppercase">
        Origin website
      </label>
      <select
        id="origin-website"
        v-model="selected"
        class="mt-1 block w-full rounded-xl border border-surface-border bg-surface-muted px-3 py-2 text-sm text-body focus:border-primary focus:outline-none"
      >
        <option v-for="option in ORIGIN_WEBSITE_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>
    <div v-if="isCustom">
      <label for="custom-origin-url" class="block text-xs font-semibold text-body-muted uppercase">
        Custom URL
      </label>
      <input
        id="custom-origin-url"
        v-model="customUrl"
        type="url"
        inputmode="url"
        autocomplete="url"
        placeholder="https://example.eventyay.com"
        class="mt-1 block w-full rounded-xl border border-surface-border bg-surface-muted px-3 py-2 text-sm text-body focus:border-primary focus:outline-none"
      />
    </div>
  </div>
</template>

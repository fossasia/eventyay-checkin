<script setup>
import { computed, ref, watch } from 'vue'
import StandardButton from '@/components/Common/StandardButton.vue'

const props = defineProps({
  fields: {
    type: Array,
    default: () => []
  },
  hiddenFields: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['confirm', 'cancel'])

const selectedHidden = ref([...props.hiddenFields])

watch(
  () => props.hiddenFields,
  (value) => {
    selectedHidden.value = [...(value || [])]
  }
)

const visibleFields = computed(() =>
  props.fields.filter((field) => !selectedHidden.value.includes(field.key))
)

function toggleField(key) {
  if (selectedHidden.value.includes(key)) {
    selectedHidden.value = selectedHidden.value.filter((item) => item !== key)
  } else {
    selectedHidden.value = [...selectedHidden.value, key]
  }
}

function handleConfirm() {
  emit('confirm', [...selectedHidden.value])
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
    <div class="card w-full max-w-md p-6">
      <h2 class="text-xl font-semibold text-body">Customize your badge before printing</h2>
      <p class="mt-2 text-sm text-body-muted">
        Uncheck fields you want to hide on the printed badge.
      </p>

      <ul class="mt-4 space-y-2">
        <li v-for="field in fields" :key="field.key">
          <label class="flex items-center gap-3 text-sm text-body">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-surface-border text-primary focus:ring-primary/30"
              :checked="!selectedHidden.includes(field.key)"
              @change="toggleField(field.key)"
            />
            <span>{{ field.label }}</span>
          </label>
        </li>
      </ul>

      <p v-if="visibleFields.length === 0" class="mt-4 text-sm text-warning-dark">
        At least one field should remain visible on the badge.
      </p>

      <div class="mt-6 space-y-2">
        <StandardButton
          type="button"
          text="Continue to print"
          variant="primary"
          block
          :disabled="visibleFields.length === 0"
          @click="handleConfirm"
        />
        <StandardButton type="button" text="Cancel" variant="white" block @click="handleCancel" />
      </div>
    </div>
  </div>
</template>

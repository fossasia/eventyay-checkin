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
  },
  fieldOverrides: {
    type: Object,
    default: () => ({})
  },
  allowBadgeEditing: {
    type: Boolean,
    default: false
  },
  showPreview: {
    type: Boolean,
    default: true
  },
  mode: {
    type: String,
    default: 'print',
    validator: (value) => ['print', 'edit'].includes(value)
  }
})

const emit = defineEmits(['confirm', 'cancel', 'preview'])

const selectedHidden = ref([...props.hiddenFields])
const fieldValues = ref({})

function buildFieldValues(sourceFields, overrides) {
  const values = {}
  for (const field of sourceFields) {
    const key = String(field.key || '')
    if (!key) {
      continue
    }
    values[key] = String(overrides?.[key] ?? field.value ?? '')
  }
  return values
}

watch(
  () => [props.fields, props.hiddenFields, props.fieldOverrides],
  () => {
    selectedHidden.value = [...(props.hiddenFields || [])]
    fieldValues.value = buildFieldValues(props.fields, props.fieldOverrides)
  },
  { immediate: true, deep: true }
)

const isEditMode = computed(() => props.mode === 'edit')

const headingText = computed(() =>
  isEditMode.value ? 'Edit badge' : 'Customize your badge before printing'
)

const helperText = computed(() => {
  if (isEditMode.value) {
    if (props.allowBadgeEditing) {
      return 'Choose which fields to show on the badge and edit the printed text.'
    }
    return 'Uncheck fields if you want to hide them on the badge.'
  }
  if (props.allowBadgeEditing) {
    return 'Choose which fields to show and edit the text that will appear on the printed badge.'
  }
  return 'Uncheck fields if you want to hide them on the printed badge.'
})

const confirmButtonText = computed(() => (isEditMode.value ? 'Save badge' : 'Continue to print'))

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

function buildCustomizationResult() {
  const hiddenFields = [...selectedHidden.value]
  if (!props.allowBadgeEditing) {
    return hiddenFields
  }

  const fieldOverrides = {}
  for (const field of visibleFields.value) {
    const key = String(field.key || '')
    if (!key) {
      continue
    }
    const value = String(fieldValues.value[key] || '').trim()
    const original = String(field.value || '').trim()
    if (value && value !== original) {
      fieldOverrides[key] = value
    }
  }

  return { hiddenFields, fieldOverrides }
}

function handleConfirm() {
  emit('confirm', buildCustomizationResult())
}

function handlePreview() {
  emit('preview', buildCustomizationResult())
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
    <div class="card w-full max-w-md p-6">
      <h2 class="text-xl font-semibold text-body">{{ headingText }}</h2>
      <p class="mt-2 text-sm text-body-muted">
        {{ helperText }}
      </p>

      <ul class="mt-4 space-y-3">
        <li v-for="field in fields" :key="field.key" class="space-y-2">
          <label class="flex items-center gap-3 text-sm text-body">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-surface-border text-primary focus:ring-primary/30"
              :checked="!selectedHidden.includes(field.key)"
              @change="toggleField(field.key)"
            />
            <span>{{ field.label }}</span>
          </label>
          <input
            v-if="allowBadgeEditing && !selectedHidden.includes(field.key)"
            v-model="fieldValues[field.key]"
            type="text"
            class="w-full"
            :aria-label="`Edit badge field: ${field.label}`"
          />
        </li>
      </ul>

      <p v-if="visibleFields.length === 0" class="mt-4 text-sm text-warning-dark">
        At least one field should remain visible on the badge.
      </p>

      <div class="mt-6 space-y-2">
        <StandardButton
          v-if="showPreview"
          type="button"
          text="Preview badge"
          variant="white"
          block
          :disabled="visibleFields.length === 0"
          @click="handlePreview"
        />
        <StandardButton
          type="button"
          :text="confirmButtonText"
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
